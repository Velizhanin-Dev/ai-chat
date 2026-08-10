// Разовый бэкфилл ачивок для существующих юзеров: считает счётчики действий из
// уже накопленных данных (сообщения, проекты, превью, разборы, подключения) и
// проставляет UserCounter + UserActivityDay. Уровни ачивок считаются из счётчиков
// НА ЧТЕНИЕ (см. buildView), поэтому UserAchievement трогать не нужно — медали и
// уровни появятся сами при первом открытии раздела.
//
// Запуск:   node scripts/backfill-achievements.mjs          (применить)
//           node scripts/backfill-achievements.mjs --dry     (только показать)
//
// Идемпотентно: счётчики ставятся значением (SET), а не инкрементом — повторный
// прогон не задваивает. Счётчик chat_message = все ответы ассистента в истории
// (Message role=assistant), т.е. включает и то, что уже начислилось после запуска.
//
// video_analysis (ИИ-разбор ролика) НЕ бэкфиллится — эти вызовы нигде не сохраняются.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

const dayKey = (d) => d.toISOString().slice(0, 10);

const users = await prisma.user.findMany({ select: { id: true, email: true } });
console.log(`Пользователей: ${users.length}${DRY ? " (dry-run)" : ""}`);

let touched = 0;
for (const u of users) {
  const convs = await prisma.conversation.findMany({
    where: { userId: u.id },
    select: { id: true, brief: true, createdAt: true },
  });
  const convIds = convs.map((c) => c.id);

  const [chatMessages, thumbs, analyses, ytConnected] = await Promise.all([
    convIds.length
      ? prisma.message.count({ where: { conversationId: { in: convIds }, role: "assistant" } })
      : 0,
    prisma.thumbnail.count({ where: { userId: u.id, kind: "generation" } }),
    prisma.channelAnalysis.count({ where: { userId: u.id } }),
    convIds.length
      ? prisma.youTubeIntegration.count({ where: { conversationId: { in: convIds } } })
      : 0,
  ]);

  const counters = {
    chat_message: chatMessages,
    project_created: convs.length,
    brief_done: convs.filter((c) => c.brief != null).length,
    thumbnail_generated: thumbs,
    channel_analysis: analyses,
    youtube_connected: ytConnected,
  };

  // Дни активности — из временных меток (для «серии» и «активных дней»).
  const days = new Set();
  convs.forEach((c) => days.add(dayKey(c.createdAt)));
  if (convIds.length) {
    const msgs = await prisma.message.findMany({
      where: { conversationId: { in: convIds } },
      select: { createdAt: true },
    });
    msgs.forEach((m) => days.add(dayKey(m.createdAt)));
  }
  for (const rows of [
    await prisma.thumbnail.findMany({ where: { userId: u.id }, select: { createdAt: true } }),
    await prisma.channelAnalysis.findMany({ where: { userId: u.id }, select: { createdAt: true } }),
  ]) {
    rows.forEach((r) => days.add(dayKey(r.createdAt)));
  }

  const hasData = Object.values(counters).some((v) => v > 0) || days.size > 0;
  if (!hasData) continue;

  if (DRY) {
    const nice = Object.entries(counters)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    console.log(`  ${u.email}: ${nice || "—"} · дней ${days.size}`);
    continue;
  }

  for (const [key, value] of Object.entries(counters)) {
    if (value <= 0) continue;
    await prisma.userCounter.upsert({
      where: { userId_key: { userId: u.id, key } },
      create: { userId: u.id, key, value },
      update: { value },
    });
  }
  for (const day of days) {
    const d = new Date(`${day}T00:00:00.000Z`);
    await prisma.userActivityDay.upsert({
      where: { userId_day: { userId: u.id, day: d } },
      create: { userId: u.id, day: d },
      update: {},
    });
  }
  touched++;
}

console.log(DRY ? "dry-run завершён" : `Готово: обновлено ${touched} пользователей`);
await prisma.$disconnect();
