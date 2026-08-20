#!/usr/bin/env bash
# Выгрузка почт пользователей НА ПРОД-СЕРВЕРЕ — список в столбик, 1 почта = 1 строка.
#
# Запускать на сервере из папки с docker-compose.yml:
#   ./scripts/export-emails-prod.sh                 → в консоль, все почты
#   ./scripts/export-emails-prod.sh emails.txt      → в файл
#   ./scripts/export-emails-prod.sh emails.txt paid → только платившие (Payment CONFIRMED)
#
# ⚠️ Ходим в БД через контейнер postgres, а не через приложение: в образе app лежит
# standalone-сборка Next без папки scripts/ и без Prisma CLI — node scripts/... там
# просто нечем запустить. psql внутри контейнера есть всегда.
#
# ⚠️ Порт 5432 наружу не смотрит (в compose он повешен на 127.0.0.1), поэтому
# подключаться снаружи не пытаемся — заходим внутрь контейнера через compose exec.
#
# ⚠️ Почты — персональные данные: файл не коммитим, передаём только тому, кто ведёт
# рассылку, и рассылаем через список с отпиской (UNISENDER_LIST_ID).
set -euo pipefail

OUT="${1:-}"
MODE="${2:-all}"

DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-creative_chat}"

# docker compose (v2) или docker-compose (v1) — что есть на сервере.
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "Не нашёл docker compose. Запусти на сервере, где развёрнут проект." >&2
  exit 1
fi

case "$MODE" in
  all)
    # ⚠️ Порядок по дате регистрации: свежие снизу — так виден прирост между выгрузками.
    SQL='SELECT email FROM "User" WHERE email IS NOT NULL AND email <> '"''"' ORDER BY "createdAt";'
    ;;
  paid)
    # «Платившими» считаем только подтверждённые платежи: строка NEW висит и у тех,
    # кто открыл оплату и передумал.
    SQL='SELECT DISTINCT u.email FROM "User" u JOIN "Payment" p ON p."userId" = u.id
         WHERE p.status = '"'"'CONFIRMED'"'"' AND u.email IS NOT NULL ORDER BY 1;'
    ;;
  trial)
    SQL='SELECT u.email FROM "User" u WHERE u.email IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM "Payment" p WHERE p."userId" = u.id AND p.status = '"'"'CONFIRMED'"'"'
         ) ORDER BY u."createdAt";'
    ;;
  *)
    echo "Неизвестный режим: $MODE (ожидается all | paid | trial)" >&2
    exit 1
    ;;
esac

# -t убирает заголовок и итоговую строку, -A — выравнивание: остаётся чистый столбик.
# ⚠️ -T у exec обязателен: без него docker выделяет TTY и дописывает \r в конец строк,
# а Unisender такие адреса потом не принимает.
RESULT="$($DC exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "$SQL" | sed '/^$/d')"

COUNT="$(printf '%s\n' "$RESULT" | sed '/^$/d' | wc -l | tr -d ' ')"

if [ -n "$OUT" ]; then
  printf '%s\n' "$RESULT" > "$OUT"
  echo "Готово: $COUNT адресов → $OUT (режим: $MODE)" >&2
else
  printf '%s\n' "$RESULT"
  echo "— всего $COUNT адресов (режим: $MODE)" >&2
fi
