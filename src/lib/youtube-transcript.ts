import { spawn } from "child_process";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "./prisma";

// ── Расшифровки роликов (субтитры) ──────────────────────────────────────────
//
// Зачем: без текста «разбор референса» сводится к гаданию по заголовку. С текстом
// ассистент видит, как построен заход, где провисает середина и на чём держится
// удержание, — и делает своё на той же механике.
//
// ⚠️⚠️ Почему через yt-dlp, а не своими руками, как в youtube-transcript-api:
// прямой путь (страница ролика → captionTracks → timedtext) БОЛЬШЕ НЕ РАБОТАЕТ.
// YouTube отвечает на такой запрос «200 OK» с ПУСТЫМ телом. Проверено с трёх
// независимых IP: домашний провайдерский, наш прод и VPS в Нидерландах — везде
// пусто, во всех форматах (json3/srv3/vtt). Дело не только в датацентрах: домашний
// резидентный адрес отказывает так же, то есть нужен proof-of-origin токен самого
// плеера. yt-dlp его добывает и подставляет актуальные клиенты — с того же VPS
// субтитры отдаются. Не «упрощай» обратно в fetch: это уже проверено и не работает.
//
// ⚠️ Видео не скачивается вообще (--skip-download) — только дорожка субтитров.
// ⚠️ Путь неофициальный: YouTube может закрыть его в любой момент. Поэтому
// отсутствие расшифровки — ШТАТНОЕ состояние, а не ошибка: разбор без неё работает
// по названию, описанию и комментариям, как раньше.

const YTDLP = process.env.YTDLP_PATH || "yt-dlp";

// ⚠️ Прод стоит в РФ и в YouTube за субтитрами НЕ ходит: их достаёт микросервис на
// зарубежном сервере (ставится scripts/setup-transcript-service.sh) — там, где проверено,
// что YouTube их отдаёт. Наружу сервис пускает Caddy по пути /yt/* с ограничением
// по IP прода; здесь только адрес и токен.
// Переменная пуста — падаем на локальный yt-dlp (годится для разработки).
const SERVICE_URL = (process.env.YT_TRANSCRIPT_URL || "").replace(/\/$/, "");
const SERVICE_TOKEN = process.env.YT_TRANSCRIPT_TOKEN || "";

// ⚠️ Прод стоит в РФ, а YouTube отдаёт субтитры не всякому адресу. Поэтому весь
// трафик yt-dlp уводим через ЗАРУБЕЖНЫЙ прокси (наш VPS в Нидерландах — на нём
// проверено, субтитры приходят). Переменная пуста — идём напрямую: это рабочий
// вариант для локальной разработки, но на проде почти наверняка вернёт «blocked».
// Формат: http://user:pass@host:port (годится и socks5://).
const PROXY = process.env.YTDLP_PROXY || "";
// Ролик длиной в час качается дольше короткого — но это всё ещё текстовый файл.
// 60 секунд с запасом; дольше ждать бессмысленно, человек уже ушёл.
const TIMEOUT_MS = Math.max(10_000, Number(process.env.YTDLP_TIMEOUT_MS ?? 60_000));

// Сколько ждём ЗАРУБЕЖНЫЙ СЕРВИС. Отдельно от локального yt-dlp выше — и это важно:
//
// ⚠️⚠️ Клиентский таймаут обязан быть БОЛЬШЕ серверного, иначе мы рвём соединение
// раньше, чем сервис успевает ответить, и его работа пропадает впустую. Ловили
// ровно это: сервис молотил до 120 с, а приложение отваливалось на 60-й.
//
// ⚠️ Про длину ролика: она влияет слабо — качается только текстовый файл субтитров
// (у часового ролика это сотни килобайт, не гигабайты). Минуты уходят не на размер,
// а на обход бот-проверки и ретраи yt-dlp. Но запас нужен, поэтому потолок здесь
// заметно выше серверного (у сервиса YTDLP_TIMEOUT = 180 с).
const SERVICE_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.YT_TRANSCRIPT_TIMEOUT_MS ?? 200_000)
);

// Сколько помним «у ролика нет субтитров».
//
// ⚠️ ЧАС, а не сутки (и не вечно, как было сначала). Причина видна на живом кейсе:
// сервис один раз ответил «нет субтитров» из-за бот-проверки, отметка легла в базу —
// и дальше человек получал мгновенный отказ, сколько бы раз ни пробовал, хотя
// сервис уже починили. Час — компромисс: у ролика без дорожек лишний запрос раз в
// час ничего не стоит, а сломанную добычу можно перепроверить сразу после починки.
const NEGATIVE_TTL_MS = 60 * 60 * 1000;

// Языки по приоритету: родная русская дорожка → автоматическая русская →
// автоперевод на русский (ru-en и подобные) → английская. Русский первым, потому
// что клиенты русскоязычные, а перевод хуже оригинала.
const SUB_LANGS = "ru,ru-orig,ru-.*,en,en-orig,en-.*";

export interface TranscriptSegment {
  /** Секунда начала реплики — по ней собираются тайм-коды в промпте. */
  at: number;
  text: string;
}

export interface Transcript {
  videoId: string;
  language: string;
  /** Автоматические субтитры (ASR) или ручные — влияет на доверие к пунктуации. */
  auto: boolean;
  segments: TranscriptSegment[];
  text: string;
}

export type TranscriptResult =
  | { status: "ok"; transcript: Transcript }
  | { status: "none" } // субтитров у ролика нет
  | { status: "blocked" } // YouTube не отдал (бот-проверка, регион, приватность)
  | { status: "error"; message: string };

/**
 * Расшифровка ролика. Сначала смотрим в БД: субтитры не меняются, а запуск
 * yt-dlp — это внешний процесс на десятки секунд.
 */
export async function getTranscript(videoId: string): Promise<TranscriptResult> {
  if (!/^[\w-]{6,}$/.test(videoId)) return { status: "error", message: "Плохой id ролика" };

  const cached = await prisma.videoTranscript
    .findUnique({ where: { videoId } })
    .catch(() => null);
  if (cached) {
    // Пустой текст в кэше — это запомненное «субтитров нет»: не дёргаем yt-dlp
    // заново на каждый разбор ролика, у которого их и не было.
    //
    // ⚠️ Но помним такое ТОЛЬКО СУТКИ, в отличие от самих субтитров (они не
    // меняются и лежат вечно). Причина: «нет субтитров» — это не всегда правда.
    // yt-dlp отдаёт ту же отметку, когда не смог их забрать по своей причине
    // (бот-проверка не распозналась как блокировка, ролик только вышел и авто-
    // субтитры ещё не сгенерированы, сервис моргнул). Без срока годности одна
    // такая осечка навсегда помечала бы ролик как «неразбираемый».
    const negativeAgeMs = Date.now() - cached.createdAt.getTime();
    if (!cached.text && negativeAgeMs < NEGATIVE_TTL_MS) return { status: "none" };
    if (!cached.text) {
      // Срок вышел — пробуем добыть заново, а протухшую отметку убираем, чтобы
      // не мешала записать свежий результат (videoId уникален).
      await prisma.videoTranscript.delete({ where: { videoId } }).catch(() => {});
    } else {
      return {
        status: "ok",
        transcript: {
          videoId,
          language: cached.language,
          auto: cached.auto,
          segments: (cached.segments as unknown as TranscriptSegment[]) ?? [],
          text: cached.text,
        },
      };
    }
  }

  const fresh = SERVICE_URL ? await fromService(videoId) : await runYtDlp(videoId);

  if (fresh.status === "ok" || fresh.status === "none") {
    // Кэшируем и отрицательный ответ (пустой текст) — см. выше.
    await prisma.videoTranscript
      .create({
        data: {
          videoId,
          language: fresh.status === "ok" ? fresh.transcript.language : "",
          auto: fresh.status === "ok" ? fresh.transcript.auto : false,
          text: fresh.status === "ok" ? fresh.transcript.text : "",
          segments:
            fresh.status === "ok"
              ? (fresh.transcript.segments as unknown as object)
              : ([] as unknown as object),
        },
      })
      .catch(() => {
        /* гонка двух разборов одного ролика — не страшно, кэш не критичен */
      });
  }
  return fresh;
}

/**
 * Забрать субтитры у зарубежного сервиса.
 *
 * ⚠️ Сервис отдаёт СЫРОЙ WebVTT, а разбираем мы его здесь — тем же parseVtt, что и
 * локальный путь. Так дедупликация «бегущей строки» и сжатие живут в одном месте:
 * две реализации на разных языках неизбежно разъедутся.
 */
async function fromService(videoId: string): Promise<TranscriptResult> {
  try {
    const res = await fetch(`${SERVICE_URL}?v=${encodeURIComponent(videoId)}`, {
      headers: SERVICE_TOKEN ? { "X-Token": SERVICE_TOKEN } : {},
      // ⚠️ Именно SERVICE_TIMEOUT_MS, а не таймаут локального yt-dlp: он больше
      // серверного, иначе оборвём сервис на полпути (см. комментарий к константе).
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return res.status === 403
        ? { status: "error", message: "Сервис расшифровок отклонил запрос (токен или IP)" }
        : { status: "error", message: `Сервис расшифровок ответил ${res.status}` };
    }

    const data = (await res.json()) as {
      status?: string;
      language?: string;
      auto?: boolean;
      vtt?: string;
    };
    if (data.status === "blocked") return { status: "blocked" };
    // ⚠️⚠️ ТАЙМАУТ — ЭТО НЕ «нет субтитров». Раньше он проваливался в общую ветку
    // ниже и возвращался как "none", а "none" КЭШИРУЕТСЯ — то есть одна медленная
    // добыча помечала ролик неразбираемым, и дальше человек получал мгновенный
    // отказ, хотя субтитры у ролика есть. Ловили на проде: сервис отвечал
    // {"status":"timeout"} за 90 секунд, а в базе появлялась пустая запись.
    if (data.status === "timeout") {
      return { status: "error", message: "Сервис расшифровок не успел ответить" };
    }
    if (data.status !== "ok" || !data.vtt) return { status: "none" };

    const segments = parseVtt(data.vtt);
    if (segments.length === 0) return { status: "none" };

    return {
      status: "ok",
      transcript: {
        videoId,
        language: data.language ?? "",
        auto: Boolean(data.auto),
        segments,
        text: segments.map((s) => s.text).join(" "),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Сервис расшифровок недоступен";
    return { status: "error", message };
  }
}

async function runYtDlp(videoId: string): Promise<TranscriptResult> {
  const dir = await mkdtemp(join(tmpdir(), "ytsub-"));
  try {
    const args = [
      ...(PROXY ? ["--proxy", PROXY] : []),
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      SUB_LANGS,
      "--sub-format",
      "vtt",
      "--no-warnings",
      "--no-progress",
      "--no-playlist",
      "-o",
      join(dir, "%(id)s.%(ext)s"),
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    const { code, stderr } = await exec(YTDLP, args);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".vtt"));

    if (files.length === 0) {
      const err = stderr.toLowerCase();
      // «Sign in to confirm you're not a bot» — упёрлись в защиту, а не в
      // отсутствие субтитров. Это разные вещи: первое чинится (сменой IP или
      // версии yt-dlp), второе — нет.
      if (err.includes("sign in") || err.includes("bot") || err.includes("blocked")) {
        return { status: "blocked" };
      }
      if (code !== 0 && err.includes("unavailable")) return { status: "none" };
      return { status: "none" };
    }

    // ⚠️ Порядок файлов на диске произвольный, а нам нужен приоритет языков:
    // сначала родная русская дорожка, потом перевод, потом английская.
    const picked = pickFile(files);
    const raw = await readFile(join(dir, picked), "utf8");
    const segments = parseVtt(raw);
    if (segments.length === 0) return { status: "none" };

    return {
      status: "ok",
      transcript: {
        videoId,
        language: languageOf(picked),
        // Имя файла у автосубтитров содержит исходный язык через дефис
        // (ru-en = автоперевод), а у ручных — просто код языка.
        auto: /-/.test(languageOf(picked)) || raw.includes("Kind: captions"),
        segments,
        text: segments.map((s) => s.text).join(" "),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось получить расшифровку";
    return { status: "error", message };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function languageOf(file: string): string {
  // «abc123.ru-en.vtt» → «ru-en»
  const parts = file.split(".");
  return parts.length >= 3 ? parts[parts.length - 2] : "";
}

function pickFile(files: string[]): string {
  const rank = (f: string): number => {
    const lang = languageOf(f);
    if (lang === "ru") return 0;
    if (lang.startsWith("ru")) return 1;
    if (lang === "en") return 2;
    if (lang.startsWith("en")) return 3;
    return 4;
  };
  return [...files].sort((a, b) => rank(a) - rank(b))[0];
}

function exec(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("yt-dlp не ответил вовремя"));
    }, TIMEOUT_MS);

    child.stderr?.on("data", (c) => {
      // Держим хвост: полный вывод не нужен, а память на длинных роликах жалко.
      stderr = (stderr + String(c)).slice(-4000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

/**
 * Разбор WebVTT в реплики с таймингами.
 *
 * ⚠️ У автосубтитров строки НАКЛАДЫВАЮТСЯ: каждая следующая карточка повторяет
 * хвост предыдущей (так в плеере получается «бегущая строка»). Без дедупликации
 * текст раздувается вдвое и читается как заикание, поэтому повторы срезаем.
 */
export function parseVtt(vtt: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let last = "";

  for (const block of vtt.replace(/\r/g, "").split("\n\n")) {
    const lines = block.split("\n").filter(Boolean);
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;

    const at = toSeconds(timeLine.split("-->")[0]?.trim() ?? "");
    const text = lines
      .filter((l) => !l.includes("-->") && !/^(WEBVTT|Kind:|Language:|NOTE)/.test(l))
      // Разметка позиций внутри строки («<00:00:01.000><c>слово</c>») — служебная.
      .map((l) => l.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text || text === last) continue;
    // Новая карточка часто начинается с хвоста прошлой — оставляем только новое.
    const fresh = last && text.startsWith(last) ? text.slice(last.length).trim() : text;
    if (!fresh) continue;

    out.push({ at, text: fresh });
    last = text;
  }
  return out;
}

function toSeconds(stamp: string): number {
  const m = /(\d+):(\d{2}):(\d{2})[.,](\d+)/.exec(stamp) ?? /(\d+):(\d{2})[.,](\d+)/.exec(stamp);
  if (!m) return 0;
  return m.length === 5
    ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    : Number(m[1]) * 60 + Number(m[2]);
}

// ── Сжатие под промпт ───────────────────────────────────────────────────────

/** Сколько символов расшифровки максимум уходит в промпт. */
export const TRANSCRIPT_PROMPT_LIMIT = 6000;
/** Начало ролика отдаём дословно: там хук, ради которого разбор и затевается. */
const VERBATIM_SECONDS = 120;

/**
 * Расшифровка в вид, пригодный для промпта: начало дословно, дальше — по реплике
 * на каждые полминуты с тайм-кодом.
 *
 * ⚠️ Целиком не отдаём: часовой ролик — это 60–90 тысяч символов, они вытеснят из
 * контекста и методику, и бриф, и сам вопрос. А для разбора важны заход и опорные
 * точки, а не каждое слово.
 */
export function condenseTranscript(t: Transcript, limit = TRANSCRIPT_PROMPT_LIMIT): string {
  const head: string[] = [];
  const rest: string[] = [];
  let nextMark = VERBATIM_SECONDS;

  for (const s of t.segments) {
    if (s.at <= VERBATIM_SECONDS) {
      head.push(s.text);
      continue;
    }
    if (s.at >= nextMark) {
      rest.push(`[${stamp(s.at)}] ${s.text}`);
      nextMark = s.at + 30;
    }
  }

  const headText = head.join(" ").trim();
  const body = [
    headText ? `Начало (первые ${VERBATIM_SECONDS} секунд дословно):\n${headText}` : "",
    rest.length ? `Дальше по ходу ролика:\n${rest.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return body.length > limit ? `${body.slice(0, limit)}…` : body;
}

function stamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Блок расшифровок для system-промпта ─────────────────────────────────────

/**
 * Расшифровки роликов, на которые человек дал ссылку в сообщении.
 *
 * ⚠️ Уходит в SYSTEM, а не в текст сообщения: в поле ввода расшифровка не нужна
 * (там остаётся ссылка, как её написал человек), а модели нужен текст.
 *
 * ⚠️ Если субтитров нет или сервис не ответил — прямо говорим об этом модели.
 * Молчание опаснее: она додумает содержание ролика, которого не видела (тот же
 * класс выдумки, что и Антипаттерн №9).
 */
/**
 * Блок на случай, когда расшифровку достать не успели (таймаут ожидания в чате).
 *
 * ⚠️ Нужен обязательно: без него в промпт не уходит НИЧЕГО, и модель отвечает по
 * общему правилу — «по ссылке я не смотрю». Для человека это выглядит так, будто
 * функции разбора роликов нет вовсе, хотя она просто не успела отработать.
 */
export function transcriptPendingBlock(videoIds: string[]): string {
  const links = videoIds.map((id) => `https://youtu.be/${id}`).join(", ");
  return [
    "РАЗБОР РОЛИКА ПО ССЫЛКЕ",
    `Человек прислал ссылку (${links}), но вытащить текст ролика не удалось: расшифровка не успела прийти или у ролика нет субтитров.`,
    "Скажи об этом ПРЯМО и по-человечески: текст ролика достать не вышло. Не говори «я не смотрю ссылки» — это неправда, обычно ты их разбираешь.",
    "Дальше предложи короткий путь: пусть пришлёт название, текст с превью и первые 20–30 секунд дословно — по ним разберёшь сразу. И скажи, что можно попробовать ещё раз через минуту: расшифровка догрузится в фоне.",
    "Содержание ролика, которого ты не видел, НЕ пересказывай и не придумывай.",
  ].join("\n");
}

export async function buildVideoTranscriptBlock(videoIds: string[]): Promise<string> {
  if (videoIds.length === 0) return "";

  const parts = await Promise.all(
    videoIds.map(async (id) => {
      const res = await getTranscript(id).catch(() => null);
      const link = `https://youtu.be/${id}`;

      if (!res || res.status !== "ok") {
        return [
          `Ролик ${link}: расшифровку получить не удалось`,
          `(${res?.status === "none" ? "у ролика нет субтитров" : "сервис расшифровок недоступен"}).`,
          `Не пересказывай содержание, которого не видел: разбирай по названию и по тому,`,
          `что человек сам расскажет про ролик, либо честно попроси пересказать.`,
        ].join(" ");
      }

      const t = res.transcript;
      return [
        `Расшифровка ролика ${link}`,
        `(${t.auto ? "автоматические субтитры, пунктуация машинная" : "субтитры автора"}` +
          `${t.language ? `, дорожка ${t.language}` : ""}):`,
        condenseTranscript(t),
      ].join(" ");
    })
  );

  return [
    "РАЗБОР РОЛИКА ПО ССЫЛКЕ",
    "Человек прислал ссылку на видео. Вот что в нём говорят — разбирай по этому тексту,",
    "а не по догадкам: где заход, на чём держится внимание, где провисает.",
    "",
    parts.join("\n\n"),
  ].join("\n");
}
