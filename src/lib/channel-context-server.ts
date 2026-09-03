import { prisma } from "./prisma";
import { buildChannelBlock, type ConnectNudge } from "./llm/system";
import { getChannelSnapshotCached } from "./youtube";
import { getPublicSnapshot } from "./youtube-public";
import { fetchInstagramSnapshot, IgReauthError } from "./instagram";
import {
  buildInstagramBlock,
  instagramNotConnectedBlock,
  type IgMissingReason,
} from "./instagram-prompt";
import { getCachedQuestions } from "./audience-questions-server";
import { normalizePlatform, type Platform } from "./platform";
import { CONNECT_YT_MARKER } from "./chat-markers";

// ── Данные площадки проекта → system-блок для промпта ────────────────────────
//
// Одна точка на всех потребителей (чат, генерация контент-плана, сборка профиля):
// раньше каждый из них сам ходил в youTubeIntegration и знал только YouTube, и
// на Instagram-проекте ассистент был слеп — в промпт не уходило ничего, даже
// того факта, что площадка другая (и он советовал CTR превью и теги).
//
// Порядок по площадке:
//  • youtube   — OAuth-снимок (полная аналитика) → канал по ссылке (публичные
//                цифры) → ничего (+ режим приглашения подключить, только в чате);
//  • instagram — снимок аккаунта → «аккаунт не подключён» (без маркера-кнопки:
//                кнопка «Подключить YouTube» на Instagram-проекте была бы ложью).
//
// Best-effort целиком: любая ошибка → без данных, вызов не роняем.

export interface ChannelContext {
  channelBlock: string | null;
  nudge: ConnectNudge;
  platform: Platform;
}

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface ResolveOpts {
  /**
   * История диалога — по ней считается режим приглашения подключить YouTube
   * (предлагали уже или нет). Без неё nudge всегда "off" (контент-план, профиль).
   */
  messages?: HistoryMessage[];
  /**
   * Мягкий таймаут на поход за снимком: в чате человек смотрит на индикатор, и
   * медленный YouTube/Instagram не должен держать ответ — снимок дорешается в
   * фоне и ляжет в кэш. Без таймаута ждём сколько нужно (фоновые задачи).
   */
  timeoutMs?: number;
}

/** Окно рилсов для промпта. ⚠️ 30 — дефолт дашборда: ключ кэша общий, второй раз в API не ходим. */
const IG_PROMPT_PERIOD_DAYS = 30;

// Promise с мягким таймаутом: по истечении отдаёт fallback (не бросает). Исходный
// промис не отменяем — дорешается в фоне и положит снимок в кэш.
function withTimeout<T>(p: Promise<T>, ms: number | undefined, fallback: T): Promise<T> {
  if (ms == null) return p.catch(() => fallback);
  return new Promise<T>((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(fallback);
      }
    }, ms);
    const settle = (v: T) => {
      if (!done) {
        done = true;
        clearTimeout(t);
        resolve(v);
      }
    };
    p.then(settle, () => settle(fallback));
  });
}

export async function resolveChannelContext(
  projectId: string,
  opts: ResolveOpts = {}
): Promise<ChannelContext> {
  const conv = await prisma.conversation
    .findUnique({ where: { id: projectId }, select: { platform: true } })
    .catch(() => null);
  const platform = normalizePlatform(conv?.platform);

  try {
    if (platform === "instagram") {
      return { platform, ...(await resolveInstagram(projectId, opts.timeoutMs)) };
    }
    return { platform, ...(await resolveYoutube(projectId, opts)) };
  } catch (err) {
    console.error("[channel-context]", platform, err);
    return { platform, channelBlock: null, nudge: "off" };
  }
}

async function resolveYoutube(
  projectId: string,
  opts: ResolveOpts
): Promise<Omit<ChannelContext, "platform">> {
  const integ = await prisma.youTubeIntegration.findUnique({
    where: { conversationId: projectId },
  });
  if (!integ) {
    // ⚠️ Второй путь: канал мог быть привязан ПО ССЫЛКЕ (бренд-аккаунт, к которому
    // у человека нет доступа через Google). Полной аналитики нет, но публичные
    // цифры есть — и это несравнимо лучше, чем ничего: ассистент видит реальные
    // ролики и охваты, а не выдумывает темы.
    const pub = await withTimeout(getPublicSnapshot(projectId), opts.timeoutMs, null);
    if (pub) {
      // Звать подключать через Google всё равно стоит (там удержание и источники),
      // но это делает сам блок — мягко и по делу, а не маркером с кнопкой: канал
      // у человека формально уже привязан.
      return { channelBlock: buildChannelBlock(pub, null, true), nudge: "off" };
    }
    if (!opts.messages) return { channelBlock: null, nudge: "off" };
    const alreadyNudged = opts.messages.some(
      (m) => m.role === "assistant" && m.content.includes(CONNECT_YT_MARKER)
    );
    return { channelBlock: null, nudge: alreadyNudged ? "gentle" : "active" };
  }

  const [snap, lastCtr] = await Promise.all([
    withTimeout(getChannelSnapshotCached(projectId, integ), opts.timeoutMs, null),
    // CTR превью API не отдаёт; берём последнюю цифру, которую юзер сам ввёл в
    // разборе канала — чтобы в чате можно было говорить о кликабельности предметно.
    prisma.channelAnalysis
      .findFirst({
        where: { conversationId: projectId, manualCtr: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { manualCtr: true },
      })
      .catch(() => null),
  ]);
  return {
    channelBlock: snap ? buildChannelBlock(snap, lastCtr?.manualCtr ?? null) : null,
    nudge: "off",
  };
}

async function resolveInstagram(
  projectId: string,
  timeoutMs: number | undefined
): Promise<Omit<ChannelContext, "platform">> {
  const integ = await prisma.instagramIntegration.findUnique({
    where: { conversationId: projectId },
    select: { tokenExpiresAt: true },
  });
  if (!integ) return { channelBlock: instagramNotConnectedBlock("none"), nudge: "off" };
  // Протухший токен getValidToken молча отдаёт как null — снимка не будет, и
  // «сейчас недоступно» тут неправда: без переподключения он не появится никогда.
  if (integ.tokenExpiresAt.getTime() <= Date.now()) {
    return { channelBlock: instagramNotConnectedBlock("expired"), nudge: "off" };
  }

  // Различаем три «нет цифр»: протухший токен (человек думает, что аккаунт
  // привязан — звать ПЕРЕподключить), таймаут/сбой (снимок дорешается в фоне и
  // ляжет в кэш — просто сейчас не подтянулось) и сам снимок.
  let reason: IgMissingReason = "unavailable";
  const snap = await withTimeout(
    fetchInstagramSnapshot(projectId, IG_PROMPT_PERIOD_DAYS).catch((err) => {
      if (err instanceof IgReauthError) reason = "expired";
      else console.error("[channel-context] instagram", err);
      return null;
    }),
    timeoutMs,
    null
  );
  if (snap) {
    // Темы из комментариев — только если уже собраны (кэш 6 ч): ради чата в API не ходим.
    const questions = getCachedQuestions(projectId)?.topics ?? [];
    return { channelBlock: buildInstagramBlock(snap, questions), nudge: "off" };
  }
  return { channelBlock: instagramNotConnectedBlock(reason), nudge: "off" };
}
