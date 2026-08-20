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
# ⚠️ Сам файл сервиса лежит в репозитории: deploy/transcript-service/server.py.
# Скрипт качает его с GitHub RAW, если запущен не из репозитория, — поэтому при
# правках сервиса не забудьте запушить их перед установкой.
set -euo pipefail

PORT="${TRANSCRIPT_PORT:-8791}"
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

# Файл сервиса: берём локальный, если скрипт запущен из репозитория, иначе с RAW.
if [ -f "deploy/transcript-service/server.py" ]; then
  cp deploy/transcript-service/server.py "$DIR/server.py"
else
  echo "Локального server.py нет — положите его в ${DIR}/server.py вручную"
  echo "(файл: deploy/transcript-service/server.py в репозитории)."
  [ -f "$DIR/server.py" ] || exit 1
fi

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
systemctl enable --now transcript >/dev/null 2>&1
sleep 1

if systemctl is-active --quiet transcript; then
  echo "сервис: работает на 127.0.0.1:${PORT}"
else
  echo "сервис: НЕ ЗАПУСТИЛСЯ — смотрите: journalctl -u transcript -n 30"
  exit 1
fi

HEALTH="$(curl -s --max-time 5 "http://127.0.0.1:${PORT}/health" || echo "нет ответа")"
echo "проверка: $HEALTH"

cat <<EOF

── Что добавить в Caddyfile на ЭТОМ сервере ─────────────────────────
Рядом с блоками для Telegram и OpenRouter:

    # Расшифровки роликов: прод в РФ спрашивает субтитры здесь.
    handle_path /yt/* {
        @allowed remote_ip ВАШ_IP_ПРОДА
        handle @allowed {
            reverse_proxy 127.0.0.1:${PORT}
        }
        respond 403
    }

    # Превью роликов: в РФ i.ytimg.com часто не открывается без VPN, поэтому
    # картинки идут через этот же сервер. Отдаём только картинки YouTube.
    handle_path /img/* {
        reverse_proxy https://i.ytimg.com {
            header_up Host i.ytimg.com
        }
        header Cache-Control "public, max-age=86400"
    }

Затем: caddy reload --config /etc/caddy/Caddyfile

── Что добавить в .env на ПРОДЕ ─────────────────────────────────────
YT_TRANSCRIPT_URL=https://ВАШ_ПРОКСИ_ДОМЕН/yt
YT_TRANSCRIPT_TOKEN=${TOKEN}
NEXT_PUBLIC_YT_IMG_PROXY=https://ВАШ_ПРОКСИ_ДОМЕН/img

⚠️ NEXT_PUBLIC_YT_IMG_PROXY инлайнится при СБОРКЕ — задайте её на build-стадии
(в docker-compose args), иначе в бандл попадёт пустое значение.

Перезапуск прода: docker compose up -d --build app
EOF
