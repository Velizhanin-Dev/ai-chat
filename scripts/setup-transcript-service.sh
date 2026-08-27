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

# ⚠️⚠️ apt-get update тут НЕ ВЫЗЫВАЕТСЯ просто так — только если чего-то реально
# не хватает. Причина: на слабом сервере он отваливается по таймауту к зеркалам и
# тянет за собой apt_news/esm_cache, забивающие единственное ядро на минуты.
# Переустановка сервиса должна занимать секунды: правки в server.py делаются часто.
apt_install() {
  if [ -z "${APT_UPDATED:-}" ]; then
    apt-get update -qq || echo "  ⚠️ apt-get update не прошёл — ставим из того, что есть"
    APT_UPDATED=1
  fi
  apt-get install -y -qq "$@" >/dev/null 2>&1
}

if ! command -v python3 >/dev/null 2>&1; then
  apt_install python3 || { echo "python3 не установился — без него никак"; exit 1; }
fi
command -v curl >/dev/null 2>&1 || apt_install curl || true

# ⚠️⚠️ JS-движок нужен НЕ ДЛЯ КРАСОТЫ. Без него yt-dlp разбирает player JS
# собственным интерпретатором на Python — замерено на проде: 53 секунды ЧИСТОГО
# процессорного времени на один ролик («JS Challenge Providers: … node
# (unavailable)» в логе). На машине с одним ядром это гарантированный таймаут.
# ⚠️ Установка НЕ ФАТАЛЬНА: без node сервис работает, просто медленно.
if ! command -v node >/dev/null 2>&1; then
  apt_install nodejs || true
fi

# Второй путь — бинарник с nodejs.org: apt тут регулярно отваливается, а в
# репозиториях версия бывает слишком старой.
if ! command -v node >/dev/null 2>&1; then
  NODE_ARCH="x64"
  case "$(uname -m)" in
    aarch64|arm64) NODE_ARCH="arm64" ;;
  esac
  NODE_VER="${NODE_VERSION:-v22.11.0}"
  echo "  node ставим бинарником ${NODE_VER} (${NODE_ARCH})"
  mkdir -p /opt/node
  # ⚠️ tar.gz, а не tar.xz: xz-utils на минимальных образах бывает не установлен.
  if curl -fsSL --max-time 180 "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-${NODE_ARCH}.tar.gz" | tar -xz -C /opt/node --strip-components=1; then
    ln -sf /opt/node/bin/node /usr/local/bin/node
  else
    echo "  ⚠️ nodejs не установился"
  fi
fi

echo "── yt-dlp ${YTDLP_VERSION} ──────────────────────────────────────"
# ⚠️ Не перекачиваем, если нужная версия уже стоит: скачивание с github — это
# ещё десятки секунд на медленном канале, а переустановка делается часто (правки
# в server.py). Принудительно перекачать — YTDLP_FORCE=1.
if [ "$(/usr/local/bin/yt-dlp --version 2>/dev/null)" = "${YTDLP_VERSION}" ] && [ -z "${YTDLP_FORCE:-}" ]; then
  echo "  уже установлен, пропускаем"
else
  # ⚠️⚠️ Качаем СБОРКУ yt-dlp_linux, а не обычный `yt-dlp`. Причина найдена
  # замером на проде: YouTube отдаёт файл субтитров только клиенту с «браузерным»
  # TLS-отпечатком, иначе — HTTP 429 Too Many Requests. yt-dlp умеет это через
  # impersonation (библиотека curl_cffi), но в обычном бинарнике её НЕТ:
  # «The extractor specified to use impersonation … but no impersonate target is
  # available» — и добыча падает уже НА СКАЧИВАНИИ найденной дорожки.
  # Сборка yt-dlp_linux собрана вместе с curl_cffi.
  YTDLP_BIN="yt-dlp_linux"
  case "$(uname -m)" in
    aarch64|arm64) YTDLP_BIN="yt-dlp_linux_aarch64" ;;
  esac
  curl -sL --max-time 180     "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${YTDLP_BIN}"     -o /usr/local/bin/yt-dlp
  chmod +x /usr/local/bin/yt-dlp
  # Битая закачка (github отдал HTML вместо бинарника) — падаем на обычную сборку,
  # чтобы сервис хотя бы работал.
  /usr/local/bin/yt-dlp --version >/dev/null 2>&1 || {
    echo "  ⚠️ ${YTDLP_BIN} не запускается — ставим обычную сборку"
    curl -sL --max-time 180       "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp"       -o /usr/local/bin/yt-dlp
    chmod +x /usr/local/bin/yt-dlp
  }
fi
/usr/local/bin/yt-dlp --version
echo "JS-движок (нужен yt-dlp, иначе разбор плеера съедает минуту CPU):"
node --version 2>/dev/null || echo "  ⚠️ node НЕ УСТАНОВЛЕН — расшифровки будут очень медленными"

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

import ipaddress
import json
import os
import socket
import re
import subprocess
import threading
import tempfile
import urllib.error
import urllib.parse
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
TIMEOUT = int(os.environ.get("YTDLP_TIMEOUT", "180"))

# ⚠️ Два обхода лимитов YouTube. Оба ОПЦИОНАЛЬНЫ — без них сервис работает как есть.
#
# COOKIES: путь к экспортированным cookies браузера (формат Netscape). Запросы от
# «залогиненного» клиента YouTube лимитирует заметно мягче. Кладётся руками рядом
# с сервисом, автоматически ничего не выгружаем.
#
# PROXY: датацентровые адреса получают HTTP 429 на файл субтитров даже с браузерным
# отпечатком — поймано на проде. Резидентный прокси эту стену убирает.
COOKIES = os.environ.get("YTDLP_COOKIES", "/opt/transcript-service/cookies.txt")
PROXY = os.environ.get("YTDLP_PROXY", "")

# ── Произвольные страницы (эндпоинт /fetch) ─────────────────────────────────
# Нужны, чтобы ассистент мог изучить сайт клиента, лендинг ЖК, статью — то, что
# он сейчас не видит вовсе. Отдаём СЫРОЙ HTML: извлечение текста живёт в
# приложении (там же, где парсеры YouTube), чтобы логика не разъезжалась.
#
# ⚠️⚠️ ЭТО ЭНДПОИНТ «СХОДИ ПО ЛЮБОМУ АДРЕСУ», то есть classic SSRF, если сделать
# наивно. Обязательные рубежи (все ниже реализованы):
#   • только http/https, никаких file://, gopher://, ftp://;
#   • резолвим DNS САМИ и запрещаем приватные, loopback и link-local адреса —
#     169.254.169.254 это метаданные облака, доступ к ним = утечка ключей;
#   • редиректы НЕ следуем автоматически, каждый шаг проверяем заново (иначе
#     «безобидный» домен редиректит на 127.0.0.1 и проверка обходится);
#   • лимит размера и таймаут, чтобы нас не подвесили на бесконечном потоке.
FETCH_MAX_BYTES = int(os.environ.get("FETCH_MAX_BYTES", str(2 * 1024 * 1024)))
FETCH_TIMEOUT = int(os.environ.get("FETCH_TIMEOUT", "20"))
FETCH_MAX_REDIRECTS = 4

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

# ── Страницы YouTube (теги роликов, конкуренция по запросу, подсказки) ──────
# Официальный API не отдаёт ни теги чужого ролика (с 2021 их видит только
# владелец), ни автодополнение, а число результатов по запросу стоит 100 units из
# 10 000 суточных. На странице всё это лежит открыто — на том же и построены
# vidIQ с TubeBuddy. Разбор HTML живёт в приложении, здесь только доставка.
#
# ⚠️ Белый список путей обязателен: без него получается открытый прокси к любому
# сайту, и его найдут в первые же сутки.
PAGE_HOSTS = {"www.youtube.com", "m.youtube.com", "youtube.com"}
PAGE_PATHS = ("/watch", "/results")
PAGE_MAX_BYTES = 4 * 1024 * 1024
PAGE_TIMEOUT = 20
SUGGEST_URL = "https://suggestqueries.google.com/complete/search"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


# ⚠️⚠️ Клиенты плеера, которыми пробуем забрать субтитры, ПО ОЧЕРЕДИ.
#
# Причина: с серверного адреса обычный веб-клиент часто упирается в «Sign in to
# confirm you're not a bot» — YouTube требует proof-of-origin токен, которого у
# датацентра нет. Клиенты мобильных приложений этой проверки обычно не получают.
# Поймано вживую: у ролика есть русская авто-дорожка (видно в плеере), а сервис
# возвращал «субтитров нет».
#
# Пустая строка = поведение по умолчанию (yt-dlp сам выберет клиента).
#
# ⚠️ Клиентов ТРИ, а не больше: общий бюджет времени делится между попытками
# (per_try = TIMEOUT // len(PLAYER_CLIENTS)), и на четырёх попытка получается
# слишком короткой — yt-dlp не успевает даже на быстром клиенте. Замерено на
# проде: обычный веб-клиент упирался в 90 секунд и отдавал таймаут. При TIMEOUT=180
# на попытку приходится по минуте — этого хватает и часовому ролику: качается
# только дорожка субтитров (сотни килобайт), а минуты уходят на обход бот-проверки.
PLAYER_CLIENTS = ["ios", "android", ""]


def _run_ytdlp(video_id: str, client: str, tmp: str):
    """Одна попытка. Возвращает (файлы, stderr) или (None, причина-ошибки)."""
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
        # ⚠️ Режем ретраи и сетевые ожидания. Без этого yt-dlp при недоступном
        # YouTube молча висит до нашего таймаута: на проде все три клиента съедали
        # по минуте каждый и отдавали «timeout» через три минуты — без единой
        # строчки о причине. Лучше быстро упасть с ошибкой в журнале.
        # ⚠️⚠️ Без этого флага yt-dlp падает на РОЛИКАХ БЕЗ ФОРМАТОВ ВИДЕО, хотя
        # субтитры он уже нашёл. Поймано на проде: в логе «Downloading subtitles:
        # ru-orig, ru», а следом «ERROR: Requested format is not available» — YouTube
        # включил SABR-эксперимент, обычных форматов у ролика нет, и yt-dlp всё
        # равно резолвит формат, хотя мы просили --skip-download.
        "--ignore-no-formats-error",
        # ⚠️ Без «браузерного» TLS-отпечатка YouTube отвечает 429 на сам файл
        # субтитров (проверено на проде). Работает только со сборкой, где есть
        # curl_cffi (yt-dlp_linux); в обычной — молча игнорируется.
        "--impersonate", "chrome",
        "--socket-timeout", "15",
        "--retries", "2",
        "--extractor-retries", "1",
        "--fragment-retries", "2",
        "-o", str(Path(tmp) / "%(id)s.%(ext)s"),
    ]
    # ⚠️⚠️ player_skip=js — САМОЕ ВАЖНОЕ здесь по скорости. Без него yt-dlp качает
    # player JS (base.js, пара мегабайт) и ИНТЕРПРЕТИРУЕТ его, чтобы расшифровать
    # сигнатуры медиа-URL. Замерено на проде: 52 секунды ЧИСТОГО процессорного
    # времени на ролик. А нам эти сигнатуры не нужны вовсе — мы качаем только
    # дорожку субтитров, она лежит по прямой ссылке из player response.
    extractor_args = ["player_skip=js"]
    if client:
        extractor_args.append(f"player_client={client}")
    if COOKIES and Path(COOKIES).is_file():
        cmd += ["--cookies", COOKIES]
    if PROXY:
        cmd += ["--proxy", PROXY]
    cmd += ["--extractor-args", "youtube:" + ";".join(extractor_args)]
    cmd.append(f"https://www.youtube.com/watch?v={video_id}")

    # ⚠️ Бюджет времени делим на число попыток: клиентов несколько, а общий потолок
    # должен остаться прежним — на той стороне человек уже смотрит на индикатор.
    per_try = max(15, TIMEOUT // len(PLAYER_CLIENTS))
    try:
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=per_try)
    except subprocess.TimeoutExpired:
        return None, "timeout"
    return sorted(Path(tmp).glob("*.vtt")), (done.stderr or "")


# ⚠️⚠️ Одновременно запускаем НЕ БОЛЬШЕ одного-двух yt-dlp.
#
# Причина: сервер маленький (нередко одно ядро), а каждый запуск — отдельный
# процесс Python, который на старте парсит страницу и грузит модули. Три-четыре
# таких процесса на одном ядре душат друг друга, и ВСЕ упираются в таймаут —
# хотя поодиночке каждый отработал бы за секунды. Человек, нажавший «разобрать»
# несколько раз подряд, устраивал себе ровно это.
#
# Ждать очереди дольше половины общего бюджета бессмысленно: лучше честно отдать
# «занято», чем сжечь весь таймаут в очереди и всё равно ничего не успеть.
_YTDLP_SLOTS = threading.Semaphore(int(os.environ.get("YTDLP_CONCURRENCY", "2")))


def fetch_subs(video_id: str):
    """Возвращает (language, vtt) или (None, причина)."""
    if not _YTDLP_SLOTS.acquire(timeout=max(5, TIMEOUT // 2)):
        print(f"[subs] {video_id}: очередь занята, отказ", flush=True)
        return None, "timeout"
    try:
        return _fetch_subs_locked(video_id)
    finally:
        _YTDLP_SLOTS.release()


def _fetch_subs_locked(video_id: str):
    last_err = ""
    for client in PLAYER_CLIENTS:
        with tempfile.TemporaryDirectory() as tmp:
            files, err = _run_ytdlp(video_id, client, tmp)
            if files is None:
                # Таймаут одной попытки — идём к следующему клиенту: обычно он и
                # оказывается быстрым. Если упрутся все, отдадим "timeout" ниже.
                last_err = err
                continue
            if files:
                if client:
                    print(f"[subs] {video_id}: сработал клиент {client}", flush=True)
                return _pick_best(files)

            last_err = err
            low = err.lower()
            # «Sign in to confirm you're not a bot» — это защита, а не отсутствие
            # субтитров. Разные вещи: первое лечится другим клиентом, второе нет.
            blocked = "sign in" in low or "bot" in low or "blocked" in low
            # Не заблокировали, а просто нет дорожек — перебирать клиентов
            # бессмысленно, у всех будет то же самое.
            if not blocked and "subtitle" not in low and "requested format" not in low:
                return None, "none"

    # ⚠️ Причину пишем в журнал: без неё «нет субтитров» и «нас забанили»
    # выглядят одинаково, и диагностировать нечем (ловили на проде).
    print(f"[subs] {video_id}: не получилось — {last_err.strip()[:300]}", flush=True)
    if last_err == "timeout":
        return None, "timeout"
    return None, "blocked" if last_err else "none"


def _pick_best(files):

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
    # ⚠️ Файл читаем ДО выхода из блока TemporaryDirectory вызывающего кода —
    # поэтому _pick_best вызывается внутри `with`, а не после него.
    return lang, best.read_text(encoding="utf-8", errors="replace")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Гасит автоматические редиректы: каждый переход проверяем сами (см. fetch_any)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


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

    def serve_page(self, query):
        """Отдаёт HTML страницы YouTube приложению (оно и разбирает).

        ⚠️ Разбор НЕ здесь: парсеры разметки живут в приложении
        (src/lib/youtube-scrape.ts), рядом с прогонами на живых страницах. Две
        реализации на разных языках неизбежно разъедутся — та же причина, по
        которой субтитры отдаются сырым WebVTT.
        """
        raw = (query.get("url") or [""])[0]
        try:
            target = urlparse(raw)
        except ValueError:
            target = None

        ok = (
            target
            and target.scheme == "https"
            and target.hostname in PAGE_HOSTS
            and target.path in PAGE_PATHS
        )
        if not ok:
            self.reply(400, {"error": "bad page url"})
            return

        try:
            limit = int((query.get("limit") or ["0"])[0])
        except ValueError:
            limit = 0
        limit = min(limit or PAGE_MAX_BYTES, PAGE_MAX_BYTES)

        try:
            req = urllib.request.Request(
                raw,
                headers={"User-Agent": BROWSER_UA, "Accept-Language": "ru,en;q=0.8"},
            )
            with urllib.request.urlopen(req, timeout=PAGE_TIMEOUT) as up:
                data = up.read(limit)
        except Exception:
            # Капча, редирект, обрыв — для приложения это штатное «данных нет».
            self.reply(200, {"html": ""})
            return

        self.reply(200, {"html": data.decode("utf-8", errors="replace")})

    def fetch_any(self, url: str, depth: int = 0):
        """Скачивает произвольную страницу. Возвращает (html, финальный_url) или (None, причина)."""
        if depth > FETCH_MAX_REDIRECTS:
            return None, "too many redirects"

        try:
            target = urlparse(url)
        except ValueError:
            return None, "bad url"
        if target.scheme not in ("http", "https") or not target.hostname:
            return None, "bad scheme"

        # ⚠️ Резолвим ИМЯ САМИ и проверяем КАЖДЫЙ адрес: домен может указывать на
        # 127.0.0.1 или на внутреннюю сеть, и без этой проверки сервис становится
        # дверью во внутренний периметр.
        try:
            infos = socket.getaddrinfo(target.hostname, None)
        except OSError:
            return None, "dns failed"
        for info in infos:
            try:
                ip = ipaddress.ip_address(info[4][0])
            except ValueError:
                return None, "bad address"
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return None, "private address"

        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": BROWSER_UA,
                "Accept-Language": "ru,en;q=0.8",
                "Accept": "text/html,application/xhtml+xml",
            },
        )
        try:
            # ⚠️ Редиректы обрабатываем РУКАМИ (NoRedirect ниже): автоматический
            # переход увёл бы нас на непроверенный адрес.
            opener = urllib.request.build_opener(_NoRedirect)
            with opener.open(req, timeout=FETCH_TIMEOUT) as up:
                ctype = (up.headers.get("Content-Type") or "").lower()
                if "html" not in ctype and "text" not in ctype and "xml" not in ctype:
                    return None, "not a page"
                return up.read(FETCH_MAX_BYTES).decode("utf-8", errors="replace"), url
        except urllib.error.HTTPError as err:
            if err.code in (301, 302, 303, 307, 308):
                location = err.headers.get("Location") or ""
                if not location:
                    return None, f"http {err.code}"
                return self.fetch_any(urllib.parse.urljoin(url, location), depth + 1)
            return None, f"http {err.code}"
        except Exception:
            return None, "unreachable"

    def serve_fetch(self, query):
        """Отдаёт HTML произвольной страницы приложению (оно и разбирает текст)."""
        raw = (query.get("url") or [""])[0]
        if not raw or len(raw) > 2000:
            self.reply(400, {"error": "bad url"})
            return

        html, info = self.fetch_any(raw)
        if html is None:
            # ⚠️ Причину возвращаем НАРУЖУ: «страницу открыть не удалось, вот
            # почему» человеку полезнее, чем молчание (та же логика, что с
            # расшифровками). Ошибкой HTTP это не считаем — для приложения это
            # штатный ответ.
            self.reply(200, {"html": "", "reason": info})
            return
        self.reply(200, {"html": html, "url": info})

    def serve_post(self, query, payload):
        """Пробрасывает POST на внутренний эндпоинт YouTube (продолжение выдачи).

        ⚠️ Без него листание выдачи не работает ВООБЩЕ: у публичной страницы своей
        «второй страницы» нет, всё подгружается POST-запросом на youtubei. Ловили
        на проде — раздел всегда показывал ровно одну страницу результатов.

        ⚠️ Белый список хостов и путей обязателен: иначе это открытый POST-прокси.
        """
        raw = (query.get("url") or [""])[0]
        try:
            target = urlparse(raw)
        except ValueError:
            target = None

        ok = (
            target
            and target.scheme == "https"
            and target.hostname == "www.youtube.com"
            and target.path.startswith("/youtubei/v1/")
        )
        if not ok:
            self.reply(400, {"error": "bad post url"})
            return

        try:
            req = urllib.request.Request(
                raw,
                data=payload,
                headers={
                    "User-Agent": BROWSER_UA,
                    "Content-Type": "application/json",
                    "Accept-Language": "ru,en;q=0.8",
                },
            )
            with urllib.request.urlopen(req, timeout=PAGE_TIMEOUT) as up:
                data = up.read(PAGE_MAX_BYTES)
        except Exception:
            self.reply(200, {"body": ""})
            return

        self.reply(200, {"body": data.decode("utf-8", errors="replace")})

    def do_POST(self):
        url = urlparse(self.path)
        if TOKEN and self.headers.get("X-Token") != TOKEN:
            self.reply(403, {"error": "forbidden"})
            return
        if url.path.rstrip("/") != "/post":
            self.reply(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        payload = self.rfile.read(min(length, 256 * 1024)) if length else b"{}"
        self.serve_post(parse_qs(url.query), payload)

    def serve_suggest(self, query):
        """Автодополнение поиска YouTube — сигнал спроса, которого нет в API."""
        q = (query.get("q") or [""])[0].strip()
        if not q or len(q) > 100:
            self.reply(400, {"error": "bad query"})
            return

        url = (
            f"{SUGGEST_URL}?client=firefox&ds=yt&hl=ru&gl=RU"
            f"&q={urllib.parse.quote(q)}"
        )
        try:
            req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA})
            with urllib.request.urlopen(req, timeout=PAGE_TIMEOUT) as up:
                raw = up.read(256 * 1024)
        except Exception:
            self.reply(200, {"raw": ""})
            return

        self.reply(200, {"raw": raw.decode("utf-8", errors="replace")})

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

        path = url.path.rstrip("/")
        if path == "/page":
            self.serve_page(parse_qs(url.query))
            return
        if path == "/suggest":
            self.serve_suggest(parse_qs(url.query))
            return
        if path == "/fetch":
            self.serve_fetch(parse_qs(url.query))
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
# ⚠️ Прокси для yt-dlp: задаётся при установке (YTDLP_PROXY=... ssh ... bash -s).
# Нужен, когда YouTube отвечает 429 на файл субтитров с адреса датацентра.
Environment=YTDLP_PROXY=${YTDLP_PROXY:-}
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

# ⚠️ Ждём с повторами, а не одну секунду: на слабой машине (одно ядро, да ещё под
# нагрузкой) python не успевает открыть сокет, и установщик писал «нет ответа» на
# исправном сервисе. Ложная тревога хуже её отсутствия — идёшь чинить рабочее.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -s --max-time 2 "http://${HOST}:${PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done

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
