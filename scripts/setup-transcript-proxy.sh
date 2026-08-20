#!/usr/bin/env bash
# Поднимает HTTP-прокси на ЗАРУБЕЖНОМ сервере — через него прод (он в РФ) ходит
# за расшифровками роликов.
#
# Запуск НА ЗАРУБЕЖНОМ VPS (не на проде!):
#   ssh root@NL-IP "tr -d '\r' | bash -s" < scripts/setup-transcript-proxy.sh <IP_ПРОДА>
#
# ⚠️ Прокси нужен именно потому, что сайт и выход в YouTube — разные машины:
# субтитры отдаются не всякому адресу, а на этом VPS проверено, что отдаются.
# Через него уходит ТОЛЬКО трафик yt-dlp (см. YTDLP_PROXY), остальное приложение
# ходит напрямую.
#
# ⚠️ Доступ закрыт по IP прода И паролем. Открытый прокси за сутки находят
# сканеры, и он превращается в чужой шлюз для спама — с последствиями для VPS.
set -euo pipefail

ALLOW_IP="${1:-}"
PORT="${2:-3128}"

if [ -z "$ALLOW_IP" ]; then
  echo "Укажите IP прод-сервера: bash setup-transcript-proxy.sh <IP_ПРОДА> [порт]" >&2
  exit 1
fi

USER_NAME="transcripts"
PASS="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)"

echo "── Ставим 3proxy ────────────────────────────────────────────────"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq 3proxy >/dev/null 2>&1 || {
  echo "3proxy не нашёлся в репозитории — ставим squid как запасной вариант…"
  apt-get install -y -qq squid apache2-utils >/dev/null
  SQUID=1
}

if [ "${SQUID:-0}" = "1" ]; then
  # ── Squid ──────────────────────────────────────────────────────────────
  htpasswd -bc /etc/squid/passwd "$USER_NAME" "$PASS" >/dev/null 2>&1
  cat > /etc/squid/squid.conf <<EOF
http_port ${PORT}

# Пускаем только прод и только с паролем — два рубежа, а не один.
acl prod src ${ALLOW_IP}/32
auth_param basic program /usr/lib/squid/basic_ncsa_auth /etc/squid/passwd
auth_param basic realm transcripts
acl authenticated proxy_auth REQUIRED

http_access allow prod authenticated
http_access deny all

# Ходим только к YouTube: если прокси всё-таки утечёт, чужим шлюзом он не станет.
acl youtube dstdomain .youtube.com .googlevideo.com .ytimg.com .google.com
http_access deny !youtube

# Не кэшируем: субтитры мы и так кладём в свою базу, а лишний диск ни к чему.
cache deny all
forwarded_for delete
via off
EOF
  systemctl restart squid
  systemctl enable squid >/dev/null 2>&1
  SERVICE=squid
else
  # ── 3proxy ─────────────────────────────────────────────────────────────
  cat > /etc/3proxy/3proxy.cfg <<EOF
daemon
maxconn 64
nserver 1.1.1.1
nserver 8.8.8.8
nscache 65536
timeouts 1 5 30 60 180 1800 15 60

users ${USER_NAME}:CL:${PASS}
auth strong

# Только прод и только к YouTube (см. комментарий про открытые прокси выше).
allow ${USER_NAME} ${ALLOW_IP} *.youtube.com,*.googlevideo.com,*.ytimg.com,*.google.com
deny *

proxy -p${PORT} -a
EOF
  systemctl restart 3proxy
  systemctl enable 3proxy >/dev/null 2>&1
  SERVICE=3proxy
fi

# Фаервол: порт открываем ТОЛЬКО для прода, если ufw включён.
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow from "$ALLOW_IP" to any port "$PORT" proto tcp >/dev/null
  echo "ufw: порт ${PORT} открыт только для ${ALLOW_IP}"
fi

sleep 1
systemctl is-active --quiet "$SERVICE" && STATE="работает" || STATE="НЕ ЗАПУСТИЛСЯ"
MYIP="$(curl -s --max-time 10 https://api.ipify.org || echo "?")"

echo
echo "── Готово ───────────────────────────────────────────────────────"
echo "сервис:  $SERVICE — $STATE"
echo "адрес:   http://${USER_NAME}:${PASS}@${MYIP}:${PORT}"
echo
echo "Впишите на ПРОДЕ в .env одной строкой:"
echo
echo "YTDLP_PROXY=http://${USER_NAME}:${PASS}@${MYIP}:${PORT}"
echo
echo "и перезапустите приложение: docker compose up -d app"
echo
echo "Проверить с прода:"
echo "  curl -s -x 'http://${USER_NAME}:${PASS}@${MYIP}:${PORT}' https://www.youtube.com -o /dev/null -w '%{http_code}\\n'"
