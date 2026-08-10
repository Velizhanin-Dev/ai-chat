import { prisma } from "./prisma";
import { getPlanById } from "./plans";
import {
  ACHIEVEMENTS,
  buildView,
  dayKey,
  levelFor,
  resolveSpec,
  streakFrom,
  STEP_KEYS,
  type AchievementsView,
  type CounterKey,
  type MetricKey,
  type PlanLimitsLite,
  type StepKey,
} from "./achievements";

// Лимиты тарифа пользователя — от них зависят пороги ачивок под запросы/проекты
// (см. resolveSpec). Тариф архивный/битый → нули (ограничения нет).
async function planLimitsFor(userId: string): Promise<PlanLimitsLite> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } });
  const plan = u ? await getPlanById(u.plan) : null;
  return { requests: plan?.limits.requests ?? 0, projects: plan?.limits.projects ?? 0 };
}

// ── Геймификация: серверная часть ──────────────────────────────────────────
// docs/achievements.md. Трекинг действий, пересчёт уровней и сборка витрины.
// ⚠️ trackAction зовут ТОЛЬКО fire-and-forget: это побочка, а не бизнес-логика,
// падение трекинга не должно ронять ответ пользователю.

// Отметить действие: день активности + счётчик + пересчёт взятых уровней.
export async function trackAction(
  userId: string,
  key: CounterKey,
  inc = 1
): Promise<void> {
  if (!userId || inc <= 0) return;

  const day = new Date(`${dayKey()}T00:00:00.000Z`);
  // Дважды за день — не ошибка, просто ничего не меняет.
  await prisma.userActivityDay
    .upsert({ where: { userId_day: { userId, day } }, create: { userId, day }, update: {} })
    .catch(() => {});

  await prisma.userCounter.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, value: inc },
    update: { value: { increment: inc } },
  });

  await syncLevels(userId);
}

// Только отметить день активности (без счётчика) — для серии/«постоянства».
export async function trackActivity(userId: string): Promise<void> {
  if (!userId) return;
  const day = new Date(`${dayKey()}T00:00:00.000Z`);
  await prisma.userActivityDay
    .upsert({ where: { userId_day: { userId, day } }, create: { userId, day }, update: {} })
    .catch(() => {});
  await syncLevels(userId);
}

// Шаг дорожной карты ЗАСЧИТАН (docs/channel-roadmap.md) — зовём из проверки
// переразбором, а не по нажатию галочки. Идемпотентно: шаг закрывается один раз,
// повторный вызов ничего не меняет. Если позже галочка «отжимается» (изменений
// на канале нет и нового видео нет) — сам шаг возвращается в работу, а ачивку НЕ
// отбираем: в геймификации ничего не отнимаем (см. docs/achievements.md).
export async function completeStep(userId: string, step: StepKey): Promise<void> {
  if (!userId) return;
  await prisma.userCounter.upsert({
    where: { userId_key: { userId, key: step } },
    create: { userId, key: step, value: 1 },
    update: {},
  });
  await trackActivity(userId);
}

// Fire-and-forget обёртка: зовём из роутов, ошибку только логируем.
export function track(userId: string, key: CounterKey, inc = 1): void {
  trackAction(userId, key, inc).catch((err) =>
    console.error(`[achievements] track ${key} error:`, err)
  );
}

// Текущие значения всех метрик пользователя (счётчики + производные из дней).
async function collectMetrics(userId: string): Promise<{
  values: Record<MetricKey, number>;
  streak: number;
  daysActive: number;
}> {
  const [counters, days] = await Promise.all([
    prisma.userCounter.findMany({ where: { userId } }),
    prisma.userActivityDay.findMany({
      where: { userId },
      select: { day: true },
      orderBy: { day: "desc" },
    }),
  ]);

  const values = {} as Record<MetricKey, number>;
  for (const c of counters) values[c.key as MetricKey] = c.value;

  const dayKeys = days.map((d) => d.day.toISOString().slice(0, 10));
  const streak = streakFrom(dayKeys);
  const daysActive = dayKeys.length;
  values.streak = streak;
  values.days_active = daysActive;
  // Сколько шагов дорожной карты закрыто (docs/channel-roadmap.md): шаг считается
  // закрытым один раз, поэтому берём факт (>0), а не сумму инкрементов.
  values.steps_done = STEP_KEYS.reduce((n, k) => n + ((values[k] ?? 0) > 0 ? 1 : 0), 0);
  return { values, streak, daysActive };
}

// Пересчитать взятые уровни. Уровень НЕ понижается (Math.max): каталог могли
// поправить, а отбирать взятое нельзя. Апсертим только то, что выросло, —
// иначе на каждое действие переписывали бы unlockedAt всех ачивок.
async function syncLevels(userId: string): Promise<void> {
  const [{ values }, saved, limits] = await Promise.all([
    collectMetrics(userId),
    prisma.userAchievement.findMany({ where: { userId } }),
    planLimitsFor(userId),
  ]);
  const byCode = new Map(saved.map((s) => [s.code, s]));

  for (const base of ACHIEVEMENTS) {
    // Пороги под тариф — иначе уровень считался бы по базовым, а UI по плановым.
    const spec = resolveSpec(base, limits);
    const level = levelFor(spec, values[spec.metric] ?? 0);
    if (level <= 0) continue;
    const prev = byCode.get(spec.code);
    if (prev && prev.level >= level) continue;
    await prisma.userAchievement.upsert({
      where: { userId_code: { userId, code: spec.code } },
      create: { userId, code: spec.code, level },
      // Новый уровень — снова «новое» (seenAt сбрасываем) и свежая дата.
      update: { level, unlockedAt: new Date(), seenAt: null },
    });
  }
}

// Витрина для клиента: значения, уровни, прогресс к следующей цели.
export async function getAchievementsView(userId: string): Promise<AchievementsView> {
  const [{ values, streak, daysActive }, saved, limits] = await Promise.all([
    collectMetrics(userId),
    prisma.userAchievement.findMany({ where: { userId } }),
    planLimitsFor(userId),
  ]);
  const byCode = new Map(saved.map((s) => [s.code, s]));

  const items = ACHIEVEMENTS.map((base) => {
    const spec = resolveSpec(base, limits); // пороги под тариф
    return buildView(spec, values[spec.metric] ?? 0, byCode.get(spec.code) ?? null);
  });

  return {
    items,
    levels: items.reduce((sum, i) => sum + i.level, 0),
    totalLevels: items.reduce((sum, i) => sum + i.maxLevel, 0),
    fresh: items.filter((i) => i.fresh).length,
    streak,
    daysActive,
  };
}

// Пользователь посмотрел ачивки — гасим метки «новое».
export async function markAchievementsSeen(userId: string): Promise<void> {
  await prisma.userAchievement.updateMany({
    where: { userId, seenAt: null },
    data: { seenAt: new Date() },
  });
}
