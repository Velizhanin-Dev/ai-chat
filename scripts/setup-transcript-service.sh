#!/usr/bin/env bash
# Ставит на ЗАРУБЕЖНОМ сервере микросервис расшифровок (yt-dlp + systemd).
#
# Запуск НА ЗАРУБЕЖНОМ VPS (том же, где Caddy проксирует Telegram/OpenRouter):
#   ssh root@NL-IP "tr -d '\r' | bash -s" < scripts/setup-transcript-service.sh
#
# Зачем: прод стоит в РФ, а YouTube отдаёт субтитры не всякому адресу — с этого
# VPS отдаёт (проверено скриптом check-ytdlp.sh). Сервис слушает только localhost,
# наружу его пускает Caddy по пути /yt/* с ограничением по IP прода.
#
# ⚠️ Файл сервиса ВСТРОЕН в этот скрипт (см. ниже heredoc PYTHON_SERVICE_EOF) —
# отдельного server.py в репозитории нет намеренно. Установка идёт через
# `ssh ... bash -s`, репозиторий на сервере не развёрнут и приватен, качать
# неоткуда. Правите сервис — правьте здесь: это его единственный источник.
set -euo pipefail

PORT="${TRANSCRIPT_PORT:-8791}"

# На каком адресе слушать. Если на сервере есть docker (а Caddy у нас в нём),
# берём адрес моста: из контейнера localhost хоста не виден.
if [ -n "${TRANSCRIPT_HOST:-}" ]; then
  HOST="$TRANSCRIPT_HOST"
elif ip -4 addr show docker0 >/dev/null 2>&1; then
  HOST="$(ip -4 addr show docker0 | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)"
  HOST="${HOST:-172.17.0.1}"
else
  HOST="127.0.0.1"
fi
YTDLP_VERSION="${YTDLP_VERSION:-2026.08.19}"
DIR=/opt/transcript-service

echo "── Зависимости ──────────────────────────────────────────────────"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 curl >/dev/null

echo "── yt-dlp ${YTDLP_VERSION} ──────────────────────────────────────"
curl -sL --max-time 120 \
  "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" \
  -o /usr/local/bin/yt-dlp
chmod +x /usr/local/bin/yt-dlp
/usr/local/bin/yt-dlp --version

echo "── Сервис ───────────────────────────────────────────────────────"
mkdir -p "$DIR"

# ⚠️ Файл сервиса ВСТРОЕН в этот скрипт, а не качается и не копируется отдельно:
# установка идёт через `ssh ... bash -s`, репозитория на сервере нет, а сам он
# приватный — скачать неоткуда. Так установка проходит одной командой.
# Правите сервис — правьте здесь; это единственный его источник.
cat > "$DIR/server.py" <<'PYTHON_SERVICE_EOF'
#!/usr/bin/env python3
"""Микросервис расшифровок: отдаёт субтитры ролика YouTube.

Живёт на ЗАРУБЕЖНОМ сервере (том же, где Caddy уже проксирует Telegram и
OpenRouter). Прод стоит в РФ и в YouTube за субтитрами не ходит вовсе — он
спрашивает этот сервис по внутреннему пути Caddy.

⚠️ Почему сервис, а не forward-прокси: Caddy — reverse-proxy, HTTP CONNECT он
без стороннего плагина не умеет. А сервис ложится в уже работающую схему
(путь в Caddyfile + ограничение по remote_ip), ничего нового поднимать не надо.

⚠️ Отдаём СЫРОЙ WebVTT, не разобранный: парсер, дедупликация «бегущей строки» и
сжатие под промпт уже написаны на стороне приложения (src/lib/youtube-transcript.ts).
Дублировать эту логику на двух языках — верный способ развести их поведение.

Только stdlib: на VPS ничего не ставим, кроме самого yt-dlp.

Запуск: TRANSCRIPT_TOKEN=<секрет> python3 server.py  (слушает 127.0.0.1:8791)
"""

import json
import os
import re
import subprocess
import tempfile
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# ⚠️ Слушаем адрес из окружения, а не жёстко 127.0.0.1: Caddy у нас в КОНТЕЙНЕРЕ,
# и localhost для него — это он сам, а не хост. Отсюда «connection refused» на
# reverse_proxy 127.0.0.1. Ставим адрес docker-моста (обычно 172.17.0.1) — он виден
# контейнерам и хосту, но недоступен из интернета.
HOST = os.environ.get("TRANSCRIPT_HOST", "127.0.0.1")
PORT = int(os.environ.get("TRANSCRIPT_PORT", "8791"))
TOKEN = os.environ.get("TRANSCRIPT_TOKEN", "")
YTDLP = os.environ.get("YTDLP_PATH", "/usr/local/bin/yt-dlp")
TIMEOUT = int(os.environ.get("YTDLP_TIMEOUT", "90"))

# Русский первым: клиенты русскоязычные, а автоперевод хуже оригинала.
SUB_LANGS = "ru,ru-orig,ru-.*,en,en-orig,en-.*"
VIDEO_ID = re.compile(r"^[\w-]{6,20}$")

# ── Картинки YouTube ────────────────────────────────────────────────────────
# Превью, аватары каналов и баннеры лежат на разных доменах Google, и в России
# они часто не открываются без VPN — карточки на сайте выходят пустыми. Поэтому
# отдаём их через этот же сервер.
#
# ⚠️ Белый список ХОСТОВ обязателен: иначе получается открытый прокси для любых
# картинок, и его быстро найдут и приспособят под чужой трафик.
IMAGE_HOSTS = {
    "i.ytimg.com", "i9.ytimg.com", "img.youtube.com",   # превью роликов
    "yt3.ggpht.com", "yt3.googleusercontent.com",       # аватары и баннеры каналов
    "lh3.googleusercontent.com",
}
IMAGE_MAX_BYTES = 8 * 1024 * 1024
IMAGE_TIMEOUT = 15


def fetch_subs(video_id: str):
    """Возвращает (language, vtt) или (None, причина)."""
    with tempfile.TemporaryDirectory() as tmp:
        cmd = [
            YTDLP,
            "--skip-download",
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs", SUB_LANGS,
            "--sub-format", "vtt",
            "--no-warnings",
            "--no-progress",
            "--no-playlist",
            "-o", str(Path(tmp) / "%(id)s.%(ext)s"),
            f"https://www.youtube.com/watch?v={video_id}",
        ]
        try:
            done = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            return None, "timeout"

        files = sorted(Path(tmp).glob("*.vtt"))
        if not files:
            err = (done.stderr or "").lower()
            # «Sign in to confirm you're not a bot» — это защита, а не отсутствие
            # субтитров. Разные вещи: первое чинится, второе нет.
            if "sign in" in err or "bot" in err or "blocked" in err:
                return None, "blocked"
            return None, "none"

        def rank(p: Path) -> int:
            lang = p.name.split(".")[-2] if p.name.count(".") >= 2 else ""
            if lang == "ru":
                return 0
            if lang.startswith("ru"):
                return 1
            if lang == "en":
                return 2
            if lang.startswith("en"):
                return 3
            return 4

        best = sorted(files, key=rank)[0]
        lang = best.name.split(".")[-2] if best.name.count(".") >= 2 else ""
        return lang, best.read_text(encoding="utf-8", errors="replace")


class Handler(BaseHTTPRequestHandler):
    # Тише в логах: журнал systemd не должен пухнуть от каждого запроса.
    def log_message(self, *args):
        pass

    def reply(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_image(self, query):
        """Проксирует картинку YouTube. Без токена: её грузит БРАУЗЕР пользователя,
        и никакого секрета у него нет. Защита — белый список хостов и лимит размера."""
        raw = (query.get("u") or [""])[0]
        try:
            target = urlparse(raw)
        except ValueError:
            target = None

        if not target or target.scheme != "https" or target.hostname not in IMAGE_HOSTS:
            self.reply(400, {"error": "bad image url"})
            return

        try:
            req = urllib.request.Request(raw, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=IMAGE_TIMEOUT) as up:
                ctype = up.headers.get("Content-Type", "image/jpeg")
                if not ctype.startswith("image/"):
                    self.reply(400, {"error": "not an image"})
                    return
                data = up.read(IMAGE_MAX_BYTES)
        except Exception:
            # Битая ссылка или удалённый канал — для страницы это просто «нет картинки».
            self.reply(404, {"error": "not found"})
            return

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        # Сутки в кэше браузера: аватары и превью меняются редко, а каждый заход
        # на раздел иначе тянул бы их заново через этот сервер.
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)

        if url.path.rstrip("/") in ("/health", ""):
            self.reply(200, {"ok": True})
            return

        # Caddy срезает свой префикс: /img/image → /image, /yt/transcript → /transcript.
        if url.path.rstrip("/") == "/image":
            self.serve_image(parse_qs(url.query))
            return

        # ⚠️ Токен обязателен, даже несмотря на ограничение по IP в Caddy: два
        # рубежа, а не один — сервис отдаёт наружу чужой контент, и открытый
        # эндпоинт быстро найдут.
        if TOKEN and self.headers.get("X-Token") != TOKEN:
            self.reply(403, {"error": "forbidden"})
            return

        video_id = (parse_qs(url.query).get("v") or [""])[0]
        if not VIDEO_ID.match(video_id):
            self.reply(400, {"error": "bad video id"})
            return

        lang, data = fetch_subs(video_id)
        if lang is None:
            status = data  # none | blocked | timeout
            self.reply(200, {"status": status})
            return

        self.reply(200, {
            "status": "ok",
            "language": lang,
            # Дефис в коде дорожки = автоперевод (ru-en), значит текст машинный.
            "auto": "-" in lang,
            "vtt": data,
        })


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
PYTHON_SERVICE_EOF
chmod 644 "$DIR/server.py"
python3 -c "import ast; ast.parse(open('$DIR/server.py', encoding='utf-8').read())"   || { echo "server.py не разбирается — установка прервана"; exit 1; }

# Токен: генерируем один раз и больше не трогаем, иначе на проде придётся менять .env.
if [ -f "$DIR/token" ]; then
  TOKEN="$(cat "$DIR/token")"
  echo "токен: используем существующий"
else
  TOKEN="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  printf '%s' "$TOKEN" > "$DIR/token"
  chmod 600 "$DIR/token"
  echo "токен: сгенерирован новый"
fi

# ⚠️ Сервис слушает ТОЛЬКО 127.0.0.1: наружу его отдаёт Caddy, а он уже проверяет
# IP прода. Открытый в интернет сервис расшифровок за сутки найдут сканеры.
cat > /etc/systemd/system/transcript.service <<EOF
[Unit]
Description=YouTube transcript service (yt-dlp)
After=network.target

[Service]
Type=simple
Environment=TRANSCRIPT_HOST=${HOST}
Environment=TRANSCRIPT_PORT=${PORT}
Environment=TRANSCRIPT_TOKEN=${TOKEN}
Environment=YTDLP_PATH=/usr/local/bin/yt-dlp
ExecStart=/usr/bin/python3 ${DIR}/server.py
Restart=always
RestartSec=3
# Мелкая защита от сюрпризов: сервис не должен ничего писать вне своей папки.
ProtectSystem=strict
PrivateTmp=true
NoNewPrivileges=true
ReadWritePaths=${DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable transcript >/dev/null 2>&1
# ⚠️ Именно restart, а не `enable --now`: последний только СТАРТУЕТ остановленный
# сервис, а работающий оставляет как есть — со старым кодом и старым окружением.
# На этом уже спотыкались: юнит обновился, а процесс продолжал слушать 127.0.0.1.
systemctl restart transcript
sleep 1

if systemctl is-active --quiet transcript; then
  echo "сервис: работает на ${HOST}:${PORT}"
else
  echo "сервис: НЕ ЗАПУСТИЛСЯ — смотрите: journalctl -u transcript -n 30"
  exit 1
fi

HEALTH="$(curl -s --max-time 5 "http://${HOST}:${PORT}/health" || echo "нет ответа")"
echo "проверка: $HEALTH"

cat <<EOF

── Что добавить в Caddyfile на ЭТОМ сервере ─────────────────────────
Внутрь блока {\$PROXY_DOMAIN}, рядом с /tg/* и /or/* (ДО корневого reverse_proxy —
он работает как «всё остальное»):

    # Расшифровки роликов: сюда ходит только прод, поэтому закрываем по IP.
    handle_path /yt/* {
        @prod remote_ip ВАШ_IP_ПРОДА
        handle @prod {
            reverse_proxy ${HOST}:${PORT}
        }
        respond 403
    }

    # Картинки YouTube (превью, аватары, баннеры): в РФ их домены без VPN не
    # открываются. ⚠️ По IP НЕ закрываем — сюда ходит браузер пользователя, а не
    # прод. Защита на стороне сервиса: белый список хостов Google и лимит размера.
    handle_path /img/* {
        reverse_proxy ${HOST}:${PORT}
    }

Затем: docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
(или systemctl reload caddy — смотря как запущен)

── Что добавить в .env на ПРОДЕ ─────────────────────────────────────
YT_TRANSCRIPT_URL=https://ВАШ_ПРОКСИ_ДОМЕН/yt/transcript
YT_TRANSCRIPT_TOKEN=${TOKEN}
NEXT_PUBLIC_YT_IMG_PROXY=https://ВАШ_ПРОКСИ_ДОМЕН/img

⚠️ NEXT_PUBLIC_YT_IMG_PROXY инлайнится при СБОРКЕ — задайте её на build-стадии
(в docker-compose args рядом с другими NEXT_PUBLIC_*), иначе в бандл попадёт
пустая строка и картинки снова пойдут напрямую.

Перезапуск прода: docker compose up -d --build app

── Проверка ─────────────────────────────────────────────────────────
С прода:
  curl -s -H "X-Token: ${TOKEN}" "https://ВАШ_ПРОКСИ_ДОМЕН/yt/transcript?v=M7lc1UVf-VE" | head -c 200
Из браузера (картинка должна открыться):
  https://ВАШ_ПРОКСИ_ДОМЕН/img/image?u=https%3A%2F%2Fi.ytimg.com%2Fvi%2FM7lc1UVf-VE%2Fhqdefault.jpg
EOF
