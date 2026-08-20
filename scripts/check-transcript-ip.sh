#!/usr/bin/env bash
# Проверка: пропускает ли YouTube ЭТОТ сервер к субтитрам (timedtext).
#
# Запуск с локальной машины, без копирования файла:
#   ssh user@vps 'bash -s' < scripts/check-transcript-ip.sh
# или на самом сервере:
#   bash check-transcript-ip.sh
#
# Что проверяем и почему именно так:
#  1. Отдаёт ли YouTube страницу ролика (если нет — IP режется целиком).
#  2. Есть ли в её HTML список дорожек субтитров (captionTracks).
#  3. ОТДАЁТ ЛИ timedtext сам текст — это главное. YouTube с 2025 года часто
#     отвечает на этот запрос «200 OK» с ПУСТЫМ телом: формально не ошибка, а
#     текста нет. Поэтому смотрим не на код ответа, а на размер тела.
#
# ⚠️ Скрипт отличает «инструмента нет» от «доступа нет»: если парсер не отработал,
# вердикта про IP НЕ выносим. Иначе отсутствие python на машине читалось бы как
# блокировка — на этом уже спотыкались.
set -uo pipefail

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
VIDEOS=("M7lc1UVf-VE" "jNQXAC9IVRw" "kJQP7kiw5Fk")

command -v curl >/dev/null || { echo "Нет curl — поставьте: apt install -y curl"; exit 1; }

# Парсер: годится и node, и python3 — что реально ЗАПУСКАЕТСЯ (наличие в PATH не
# гарантирует работу: на Windows python3 — это заглушка-алиас Microsoft Store).
PARSER=""
if command -v node >/dev/null && node -e "process.exit(0)" >/dev/null 2>&1; then
  PARSER="node"
elif command -v python3 >/dev/null && python3 -c "pass" >/dev/null 2>&1; then
  PARSER="python3"
else
  echo "Нужен node или python3, чтобы разобрать ответ YouTube."
  echo "Поставьте: apt install -y python3   (или nodejs)"
  exit 1
fi
echo "Парсер: $PARSER"
echo

echo "── Кто мы для интернета ──────────────────────────────────────────"
# По ASN/провайдеру видно, датацентр это или жильё. YouTube режет именно датацентры.
IPINFO=$(curl -s --max-time 10 https://ipinfo.io/json)
if [ -n "$IPINFO" ]; then
  printf '%s' "$IPINFO" | tr ',' '\n' | grep -E '"(ip|country|org)"' | tr -d '"' | sed 's/^ *//'
else
  echo "не удалось определить (не критично)"
fi
echo

extract_baseurl() {
  # На вход HTML, на выход baseUrl первой подходящей дорожки (ru в приоритете),
  # NO_TRACKS — если списка нет. Диагностику по языкам пишем в stderr.
  if [ "$PARSER" = "node" ]; then
    node -e '
let html = "";
process.stdin.on("data", (c) => (html += c));
process.stdin.on("end", () => {
  const m = /"captionTracks":(\[.*?\])/.exec(html);
  if (!m) { console.log("NO_TRACKS"); return; }
  const tracks = JSON.parse(m[1]);
  const langs = tracks.slice(0, 6).map((t) => t.languageCode + (t.kind === "asr" ? "(авто)" : "")).join(", ");
  process.stderr.write(`дорожки: ${tracks.length} [${langs}]\n`);
  const ru = tracks.find((t) => String(t.languageCode || "").startsWith("ru"));
  console.log((ru || tracks[0]).baseUrl);
});'
  else
    python3 -c '
import sys, json, re
html = sys.stdin.read()
m = re.search(r"\"captionTracks\":(\[.*?\])", html)
if not m:
    print("NO_TRACKS"); raise SystemExit
tracks = json.loads(m.group(1))
langs = ", ".join(t.get("languageCode","?") + ("(авто)" if t.get("kind")=="asr" else "") for t in tracks[:6])
sys.stderr.write("дорожки: %d [%s]\n" % (len(tracks), langs))
ru = next((t for t in tracks if str(t.get("languageCode","")).startswith("ru")), None)
print((ru or tracks[0])["baseUrl"])'
  fi
}

OK=0
BLOCKED=0
UNKNOWN=0

for VIDEO in "${VIDEOS[@]}"; do
  echo "── Ролик $VIDEO ──────────────────────────────────────────────────"

  HTML=$(curl -s --max-time 25 -A "$UA" -H "Accept-Language: ru-RU,ru;q=0.9,en;q=0.8" \
    -b "CONSENT=YES+cb; SOCS=CAI" "https://www.youtube.com/watch?v=${VIDEO}&hl=ru")
  SIZE=${#HTML}
  echo "страница: получено ${SIZE} байт"

  if [ "$SIZE" -lt 20000 ]; then
    echo "  ❌ Страница почти пустая — IP режется или показывают капчу."
    BLOCKED=$((BLOCKED+1)); echo; continue
  fi

  BASEURL=$(printf '%s' "$HTML" | extract_baseurl)

  if [ -z "$BASEURL" ]; then
    echo "  ⚠️  Парсер не вернул результат — про IP ничего не говорим."
    UNKNOWN=$((UNKNOWN+1)); echo; continue
  fi
  if [ "$BASEURL" = "NO_TRACKS" ]; then
    echo "  ❌ Списка дорожек в HTML нет — страницу отдали урезанную (признак блокировки)."
    BLOCKED=$((BLOCKED+1)); echo; continue
  fi

  BODY=$(curl -s --max-time 25 -A "$UA" -H "Referer: https://www.youtube.com/watch?v=${VIDEO}" "${BASEURL}&fmt=json3")
  LEN=${#BODY}
  echo "timedtext: тело ответа ${LEN} байт"

  if [ "$LEN" -gt 200 ]; then
    echo "  ✅ ТЕКСТ ОТДАЁТСЯ — с этого IP расшифровки доступны."
    OK=$((OK+1))
  else
    echo "  ❌ Пустой ответ — YouTube не отдаёт субтитры этому IP."
    BLOCKED=$((BLOCKED+1))
  fi
  echo
done

echo "── Итог ──────────────────────────────────────────────────────────"
echo "текст получен: $OK · отказ: $BLOCKED · не проверилось: $UNKNOWN"
if [ "$OK" -gt 0 ]; then
  echo "✅ Этот сервер годится как прокси для расшифровок."
  echo "   Дальше: поднять на нём HTTP-прокси и указать его в YT_TRANSCRIPT_PROXY."
elif [ "$BLOCKED" -gt 0 ]; then
  echo "❌ Этот сервер НЕ годится: YouTube режет его IP (обычное дело для дата-центров)."
  echo "   Нужен резидентный выход — домашний интернет или мобильный оператор."
else
  echo "🤷 Проверка не состоялась (сеть или парсер). Про IP ничего сказать нельзя."
fi
