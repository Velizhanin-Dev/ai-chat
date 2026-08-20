#!/usr/bin/env bash
# Проверка: достаёт ли yt-dlp субтитры с ЭТОГО сервера.
#
#   ssh user@vps "tr -d '\r' | bash -s" < scripts/check-ytdlp.sh
#
# Зачем отдельная проверка, если «ручной» путь (watch → timedtext) уже отказал:
# yt-dlp — не та же механика. Она активно поддерживается, подставляет актуальные
# клиенты плеера и умеет добывать токен, которого не хватает при прямом запросе.
# Видео не скачивается вообще — только дорожка субтитров (--skip-download).
#
# ⚠️ Ничего в систему не ставим: бинарник кладём во временную папку и удаляем.
set -uo pipefail

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "── Ставим yt-dlp во временную папку ─────────────────────────────"
if ! command -v python3 >/dev/null; then
  echo "Нужен python3 (yt-dlp на нём работает): apt install -y python3"
  exit 1
fi

curl -sL --max-time 90 \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o "$TMP/yt-dlp" || { echo "Не смог скачать yt-dlp"; exit 1; }
chmod +x "$TMP/yt-dlp"
echo "версия: $("$TMP/yt-dlp" --version 2>&1 | tail -1)"
echo

# Ролик с автосубтитрами. ru.* берём первым: нам нужен именно русский текст,
# en.* — на случай, если у пробного ролика русской дорожки нет.
VIDEOS=("M7lc1UVf-VE" "jNQXAC9IVRw")
OK=0

for V in "${VIDEOS[@]}"; do
  echo "── Ролик $V ─────────────────────────────────────────────────────"
  OUT="$TMP/$V"
  ERR="$("$TMP/yt-dlp" \
      --skip-download \
      --write-subs --write-auto-subs \
      --sub-langs 'ru.*,en.*' --sub-format vtt \
      --no-warnings --no-progress \
      -o "$OUT.%(ext)s" \
      "https://www.youtube.com/watch?v=$V" 2>&1)" || true

  FILE="$(ls "$OUT"*.vtt 2>/dev/null | head -1 || true)"
  if [ -n "$FILE" ] && [ -s "$FILE" ]; then
    SIZE=$(wc -c < "$FILE" | tr -d ' ')
    LINES=$(grep -vcE '^(WEBVTT|$|[0-9:.>< -]+$)' "$FILE" 2>/dev/null || echo 0)
    echo "  ✅ СУБТИТРЫ ЕСТЬ: $(basename "$FILE"), ${SIZE} байт, строк текста: ${LINES}"
    OK=$((OK+1))
  else
    echo "  ❌ Не получилось. Что ответил yt-dlp:"
    printf '%s\n' "$ERR" | grep -iE 'error|sign in|bot|blocked|unavailable|no subtitles' | head -4 | sed 's/^/     /'
    [ -z "$(printf '%s' "$ERR" | grep -iE 'error|sign in|bot|blocked|unavailable|no subtitles')" ] && \
      printf '%s\n' "$ERR" | tail -3 | sed 's/^/     /'
  fi
  echo
done

echo "── Итог ─────────────────────────────────────────────────────────"
if [ "$OK" -gt 0 ]; then
  echo "✅ yt-dlp достаёт субтитры с этого сервера ($OK из ${#VIDEOS[@]})."
  echo "   Значит расшифровки можно делать без прокси и без платных сервисов."
else
  echo "❌ Не достаёт. Остаются платный сервис расшифровок или официальный путь"
  echo "   для своих роликов (Captions API по OAuth канала)."
fi
