"use client";

import { Badge, Box, Group, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import { IconBrandInstagram, IconBrandYoutube, IconLock } from "@tabler/icons-react";
import { PLATFORM_META, type Platform } from "@/lib/platform";

// Первый шаг создания проекта: где человек ведёт контент. От выбора зависит всё
// дальнейшее — какие разделы в меню, какая аналитика и какого формата превью
// (16:9 против 9:16), поэтому спрашиваем ДО брифа и подключения аккаунта.
//
// ⚠️ Instagram сейчас доступен ТОЛЬКО админам («в разработке» для остальных), а
// дальше будет ограничен тарифом (Plan.limits.instagram === 0 — не продаётся).
// В обоих случаях карточку не прячем, а показываем закрытой с причиной: спрятанная
// функция читается как «её нет», а закрытая — как «есть, но пока не мне».
export default function PlatformStep({
  onPick,
  instagramLimit,
  instagramUsed,
  isAdmin,
}: {
  onPick: (p: Platform) => void;
  /** Лимит Instagram-проектов по тарифу: 0 — не продаётся, -1 — без лимита. */
  instagramLimit: number;
  /** Сколько Instagram-проектов уже заведено. */
  instagramUsed: number;
  /** ⚠️ Instagram пока обкатывают админы — остальным площадка «в разработке». */
  isAdmin: boolean;
}) {
  // Порядок проверок важен: «в разработке» перекрывает разговор про тариф —
  // пока площадку не открыли, лимит на ней ничего не значит.
  const inDev = !isAdmin;
  const igLocked =
    inDev || instagramLimit === 0 || (instagramLimit !== -1 && instagramUsed >= instagramLimit);
  const igReason = inDev
    ? "Скоро откроем — сейчас обкатываем"
    : instagramLimit === 0
      ? "Доступен на других тарифах"
      : "Все слоты Instagram заняты — освободите, удалив проект";

  return (
    <Stack gap="lg">
      <Box>
        <Text fw={700} fz={{ base: "1.2rem", sm: "1.4rem" }} lh={1.25}>
          Где вы ведёте контент?
        </Text>
        <Text size="sm" mt={6}>
          От площадки зависят разделы, цифры и формат обложек. Проект живёт на одной
          площадке — для второй заведите отдельный.
        </Text>
      </Box>

      <Group grow align="stretch" gap="md" wrap="wrap">
        <PlatformCard
          platform="youtube"
          icon={<IconBrandYoutube size={28} />}
          points={["Сценарии, контент-план, превью", "Аналитика и разбор канала", "Конкуренты и поиск референсов"]}
          onPick={onPick}
        />
        <PlatformCard
          platform="instagram"
          icon={<IconBrandInstagram size={28} />}
          points={["Сценарии рилсов и контент-план", "Удержание, пропуски, вовлечение", "Вертикальные обложки 9:16"]}
          onPick={onPick}
          locked={igLocked}
          lockReason={igReason}
          lockLabel={inDev ? "в разработке" : "закрыто"}
        />
      </Group>
    </Stack>
  );
}

function PlatformCard({
  platform,
  icon,
  points,
  onPick,
  locked,
  lockReason,
  lockLabel = "закрыто",
}: {
  platform: Platform;
  icon: React.ReactNode;
  points: string[];
  onPick: (p: Platform) => void;
  locked?: boolean;
  lockReason?: string;
  lockLabel?: string;
}) {
  const meta = PLATFORM_META[platform];
  return (
    <UnstyledButton
      className="pf-card"
      data-locked={locked ? "true" : undefined}
      disabled={locked}
      aria-label={`Площадка ${meta.label}${locked ? ` — ${lockReason}` : ""}`}
      onClick={() => !locked && onPick(platform)}
    >
      <Group gap="sm" wrap="nowrap" mb="sm">
        <ThemeIcon size={46} radius="md" variant="light" color={meta.color}>
          {icon}
        </ThemeIcon>
        <Box style={{ minWidth: 0 }}>
          <Text fw={700}>{meta.label}</Text>
          <Text size="xs">{meta.unitPlural}</Text>
        </Box>
        {locked && (
          <Badge
            ml="auto"
            size="sm"
            variant="light"
            color="gray"
            radius="sm"
            leftSection={<IconLock size={11} />}
          >
            {lockLabel}
          </Badge>
        )}
      </Group>

      <Stack gap={6}>
        {points.map((p) => (
          <Group key={p} gap={8} wrap="nowrap" align="flex-start">
            <span className="pf-tick" aria-hidden />
            <Text size="sm">{p}</Text>
          </Group>
        ))}
      </Stack>

      {locked && (
        <Text size="xs" mt="sm" c="dimmed">
          {lockReason}
        </Text>
      )}
    </UnstyledButton>
  );
}
