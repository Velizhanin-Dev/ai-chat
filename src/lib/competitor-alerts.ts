import { prisma } from "./prisma";
import { APP_URL, sendToChat } from "./telegram";
import { loadTrackedFeed } from "./competitors-server";
import {
  ALERT_MIN_RATIO,
  ALERT_MIN_VIEWS,
  ALERT_WINDOW_DAYS,
  formatRatio,
} from "./competitors";

// ── Уведомления «у конкурента залетел ролик» ─────────────────────────────────
//
// Зачем вообще: лента конкурентов полезна, только если в неё заходят. Сигнал
// «вот у него ролик уже собрал ×5 к подписчикам» — единственное, ради чего стоит
// дёргать человека, поэтому шлём именно его, а не «вышло 3 новых ролика».
//
// ⚠️ Порог берём ВЫШЕ обычного фильтра раздела: там ×3 нормальный порог для
// разбора руками, а в уведомление должно попадать только то, ради чего не жалко
// звука на телефоне. И ролик должен быть свежим — старый залетевший ролик
// новостью не является.
/** Сколько уведомлений максимум за один проход — чтобы не устроить спам-рассылку. */
const ALERT_MAX_PER_RUN = 5;

/**
 * Обойти проекты, где включены уведомления, и написать про новые залетевшие
 * ролики конкурентов.
 *
 * ⚠️ Отправляем в ЛИЧКУ пользователя (User.telegramChatId — привязка через бота
 * поддержки), а не в админский чат: это его конкуренты, а не наши. Нет привязки —
 * пропускаем проект молча, в UI на этот случай стоит кнопка «Подключить телеграм».
 */
export async function scanCompetitorAlerts(): Promise<void> {
  const projects = await prisma.conversation.findMany({
    where: { competitorAlerts: true },
    select: { id: true, title: true, user: { select: { telegramChatId: true } } },
  });

  for (const p of projects) {
    const chatId = p.user?.telegramChatId;
    if (!chatId) continue;
    try {
      await scanOne(p.id, p.title, chatId);
    } catch (err) {
      // Один сломавшийся проект не должен останавливать обход остальных.
      console.error("[alerts] проект", p.id, err);
    }
  }
}

async function scanOne(projectId: string, projectTitle: string, chatId: string): Promise<void> {
  const feed = await loadTrackedFeed(projectId, ALERT_WINDOW_DAYS);
  if (feed.status !== "ok") return;

  const hot = feed.result.videos.filter(
    (v) => v.ratio >= ALERT_MIN_RATIO && v.views >= ALERT_MIN_VIEWS
  );
  if (hot.length === 0) return;

  // Про что уже писали — второй раз не пишем (сканер ходит по расписанию и один
  // и тот же ролик видит много раз).
  const seen = await prisma.competitorAlert.findMany({
    where: { conversationId: projectId, videoId: { in: hot.map((v) => v.id) } },
    select: { videoId: true },
  });
  const seenIds = new Set(seen.map((s) => s.videoId));
  const fresh = hot.filter((v) => !seenIds.has(v.id)).slice(0, ALERT_MAX_PER_RUN);
  if (fresh.length === 0) return;

  const lines = fresh.map(
    (v) =>
      `${escapeHtml(v.channelTitle)}: <a href="https://youtu.be/${v.id}">${escapeHtml(v.title)}</a>\n` +
      `${v.views.toLocaleString("ru-RU")} просмотров · ${formatRatio(v.ratio)} к подписчикам`
  );
  const html =
    `<b>У конкурентов залетело</b>\n` +
    `Проект: ${escapeHtml(projectTitle)}\n\n` +
    lines.join("\n\n") +
    `\n\n<a href="${APP_URL}/${projectId}/competitors">Открыть референсы</a>`;

  await sendToChat(chatId, html);

  // Пишем журнал ПОСЛЕ отправки: упало — напомним в следующий проход.
  await prisma.competitorAlert.createMany({
    data: fresh.map((v) => ({ conversationId: projectId, videoId: v.id, ratio: v.ratio })),
    skipDuplicates: true,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
