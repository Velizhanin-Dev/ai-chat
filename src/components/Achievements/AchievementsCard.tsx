"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Group,
  Loader,
  Progress,
  RingProgress,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconArrowRight,
  IconCalendarStats,
  IconFlame,
  IconTrophy,
} from "@tabler/icons-react";
import { apiAchievements, apiAchievementsSeen } from "@/lib/achievements-client";
import type { AchievementsView, AchievementView } from "@/lib/achievements";
import AchievementBadge from "./AchievementBadge";
import AchievementsModal from "./AchievementsModal";

// Карточка ачивок в разделе «Канал» — «профиль игрока». Данные аккаунтные (не
// пер-проектные), projectId не нужен. Дизайн — docs + скилл ui-ux-pro-max
// (мотивирующее пустое состояние, спотлайт цели, стена медалей).

export default function AchievementsCard() {
  const [view, setView] = useState<AchievementsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    apiAchievements().then((res) => {
      if (!alive) return;
      setView(res.ok ? res.data : null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Ближайшая цель — незакрытая ачивка, к которой ближе всего по прогрессу.
  const nearest = useMemo(() => {
    if (!view) return null;
    return (
      view.items.filter((a) => !a.done && a.target != null).sort((x, y) => y.ratio - x.ratio)[0] ??
      null
    );
  }, [view]);

  // Стена медалей: сперва свежие, потом взятые, потом ближе к цели.
  const wall = useMemo(() => {
    if (!view) return [];
    return [...view.items].sort((x, y) => {
      if (x.fresh !== y.fresh) return x.fresh ? -1 : 1;
      if ((x.level > 0) !== (y.level > 0)) return x.level > 0 ? -1 : 1;
      if (x.level !== y.level) return y.level - x.level;
      return y.ratio - x.ratio;
    });
  }, [view]);

  const openAll = () => {
    setOpen(true);
    if (view?.fresh) {
      apiAchievementsSeen();
      setView((v) =>
        v ? { ...v, fresh: 0, items: v.items.map((i) => ({ ...i, fresh: false })) } : v
      );
    }
  };

  if (loading) {
    return (
      <Box className="ach-card" style={{ display: "grid", placeItems: "center", minHeight: 260 }}>
        <Loader color="brand" size="sm" />
      </Box>
    );
  }
  if (!view) {
    return (
      <Box className="ach-card">
        <Text c="dimmed">Достижения пока недоступны</Text>
      </Box>
    );
  }

  const overall = view.totalLevels > 0 ? Math.round((view.levels / view.totalLevels) * 100) : 0;

  return (
    <Box className="ach-card">
      {/* Заголовок */}
      <Group justify="space-between" align="flex-start" mb="md" wrap="nowrap">
        <Box>
          <Text fw={700} fz="1.15rem" lh={1.15}>
            Достижения
          </Text>
          <Text size="xs" c="dimmed">
            Собирай медали за работу над каналом
          </Text>
        </Box>
        <Group
          gap={6}
          wrap="nowrap"
          style={{
            padding: "5px 10px",
            borderRadius: 999,
            background: "color-mix(in srgb, var(--mantine-color-brand-6) 14%, transparent)",
          }}
        >
          <IconTrophy size={15} color="var(--mantine-color-brand-6)" />
          <Text fw={700} size="sm" c="brand">
            {view.levels}
          </Text>
          <Text size="sm" c="dimmed">
            / {view.totalLevels}
          </Text>
        </Group>
      </Group>

      {/* Герой: общий прогресс + серия/дни */}
      <Group gap="md" wrap="nowrap" align="center" mb="md">
        <RingProgress
          size={92}
          thickness={8}
          roundCaps
          sections={[{ value: overall, color: "brand" }]}
          label={
            <Box ta="center">
              <Text className="ach-hero-num" c={overall > 0 ? undefined : "dimmed"}>
                {overall}
                <Text span fz="0.7rem" fw={700} c="dimmed">
                  %
                </Text>
              </Text>
            </Box>
          }
        />
        <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
          <Box className="ach-stat">
            <IconFlame
              size={20}
              color={view.streak > 0 ? "var(--mantine-color-brand-6)" : "var(--mantine-color-dimmed)"}
            />
            <Box style={{ lineHeight: 1.1 }}>
              <Text fw={700} size="sm">
                {view.streak > 0 ? `${view.streak} дн. подряд` : "Серии нет"}
              </Text>
              <Text size="xs" c="dimmed">
                {view.streak > 0 ? "не бросай серию" : "зайди завтра снова"}
              </Text>
            </Box>
          </Box>
          <Box className="ach-stat">
            <IconCalendarStats size={20} color="var(--mantine-color-dimmed)" />
            <Box style={{ lineHeight: 1.1 }}>
              <Text fw={700} size="sm">
                {view.daysActive} {plural(view.daysActive, "день", "дня", "дней")} в деле
              </Text>
              <Text size="xs" c="dimmed">
                всего активных дней
              </Text>
            </Box>
          </Box>
        </Stack>
      </Group>

      {/* Спотлайт ближайшей цели */}
      {nearest ? (
        <Box className="ach-spotlight ach-rise" mb="md">
          <Group gap="md" wrap="nowrap" align="center">
            <AchievementBadge a={nearest} size="md" pulse tooltip={false} onClick={openAll} />
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text size="xs" c="brand" fw={700} tt="uppercase" style={{ letterSpacing: "0.04em" }}>
                Ближайшая цель
              </Text>
              <Text fw={700} lh={1.2} truncate>
                {nearest.title}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={1} mb={6}>
                {nearest.description}
              </Text>
              <Progress
                value={Math.round(nearest.ratio * 100)}
                color="brand"
                size="sm"
                radius="xl"
              />
              <Group justify="space-between" mt={3}>
                <Text size="xs" c="dimmed">
                  {nearest.nextLabel ?? "Следующий уровень"}
                </Text>
                <Text size="xs" fw={600}>
                  {nearest.value} / {nearest.target}
                  {nearest.unit ? ` ${nearest.unit}` : ""}
                </Text>
              </Group>
            </Box>
          </Group>
        </Box>
      ) : (
        <Box className="ach-spotlight ach-rise" mb="md">
          <Text fw={700} c="brand">
            Все цели взяты — красавчик 🔥
          </Text>
          <Text size="sm" c="dimmed">
            Ты собрал всю коллекцию. Держи планку.
          </Text>
        </Box>
      )}

      {/* Стена медалей */}
      <Box className="ach-wall" mb="md">
        {wall.map((a, i) => (
          <Tile key={a.code} a={a} index={i} onClick={openAll} />
        ))}
      </Box>

      <Button
        variant="light"
        color="brand"
        fullWidth
        radius="md"
        rightSection={<IconArrowRight size={16} />}
        onClick={openAll}
      >
        Все достижения
      </Button>

      <AchievementsModal view={view} opened={open} onClose={() => setOpen(false)} />
    </Box>
  );
}

// Плитка стены: медаль + короткое название + пипсы уровней.
function Tile({ a, index, onClick }: { a: AchievementView; index: number; onClick: () => void }) {
  const unlocked = a.level > 0;
  return (
    <Box
      className="ach-tile ach-rise"
      style={{ animationDelay: `${Math.min(index * 35, 500)}ms` }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={a.title}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <AchievementBadge a={a} size="sm" tooltip onClick={undefined} />
      <Text className={`ach-tile-label${unlocked ? " is-unlocked" : ""}`}>{a.title}</Text>
      {a.maxLevel > 1 && (
        <Box className="ach-pips">
          {Array.from({ length: a.maxLevel }).map((_, i) => (
            <span key={i} className={`ach-pip${i < a.level ? " on" : ""}`} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
