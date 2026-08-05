"use client";

import {
  Badge,
  Box,
  Group,
  Modal,
  Progress,
  Stack,
  Text,
} from "@mantine/core";
import type { AchievementsView, AchievementView } from "@/lib/achievements";
import AchievementBadge from "./AchievementBadge";

// Все ачивки списком с прогрессом. Открывается из карточки в разделе «Канал».

export default function AchievementsModal({
  view,
  opened,
  onClose,
}: {
  view: AchievementsView | null;
  opened: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Достижения"
      size="lg"
      radius="lg"
    >
      {view && (
        <Stack gap="lg">
          <Group gap="lg" wrap="wrap">
            <Summary label="Уровней взято" value={`${view.levels} / ${view.totalLevels}`} />
            <Summary label="Дней подряд" value={view.streak} />
            <Summary label="Активных дней" value={view.daysActive} />
          </Group>

          <Stack gap="xs">
            {sortByProgress(view.items).map((a) => (
              <Row key={a.code} a={a} />
            ))}
          </Stack>
        </Stack>
      )}
    </Modal>
  );
}

// Порядок в списке — по прогрессу: сперва то, что ближе к следующей цели (есть
// шанс добить), закрытые целиком уезжают вниз. Внутри равных — по доле взятых
// уровней, чтобы «почти собранные» шли выше только начатых.
function sortByProgress(items: AchievementView[]): AchievementView[] {
  const rank = (a: AchievementView) => {
    if (a.done) return 2; // всё взято — вниз
    return a.level > 0 ? 0 : 1; // начатые выше нетронутых
  };
  return [...items].sort((x, y) => {
    if (rank(x) !== rank(y)) return rank(x) - rank(y);
    const levelShare = (a: AchievementView) => (a.maxLevel > 0 ? a.level / a.maxLevel : 0);
    if (levelShare(x) !== levelShare(y)) return levelShare(y) - levelShare(x);
    return y.ratio - x.ratio; // ближе к ближайшей цели — выше
  });
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return (
    <Box>
      <Text fw={700} fz="1.5rem" lh={1.1} c="brand">
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Box>
  );
}

function Row({ a }: { a: AchievementView }) {
  const unlocked = a.level > 0;
  return (
    <Group className={`ach-row${unlocked ? " is-unlocked" : ""}`} gap="md" wrap="nowrap" align="center">
      <AchievementBadge a={a} size="sm" />
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs" wrap="nowrap" justify="space-between" align="baseline">
          <Text fw={600} truncate>
            {a.title}
          </Text>
          {unlocked && a.levelLabel && (
            <Badge variant="light" color="brand" radius="sm" style={{ flex: "0 0 auto" }}>
              {a.levelLabel}
            </Badge>
          )}
        </Group>
        <Text fz="0.75rem" c="dimmed" lineClamp={2}>
          {a.description}
        </Text>

        {a.done ? (
          <Text size="xs" c="brand" mt={4} fw={600}>
            Всё взято{a.maxLevel > 1 ? ` · ${a.maxLevel} ур.` : ""}
          </Text>
        ) : (
          <Box mt={6}>
            <Progress
              value={Math.round(a.ratio * 100)}
              color={unlocked ? "brand" : "gray.5"}
              size="sm"
              radius="xl"
            />
            <Group justify="space-between" mt={2}>
              <Text size="xs" c="dimmed">
                {a.nextLabel ?? "Следующий уровень"}
              </Text>
              <Text size="xs" c="dimmed">
                {a.value} / {a.target}
                {a.unit ? ` ${a.unit}` : ""}
              </Text>
            </Group>
          </Box>
        )}
      </Box>
    </Group>
  );
}
