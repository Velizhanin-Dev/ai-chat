"use client";

import { ytImage } from "@/lib/image-proxy";

import { ActionIcon, Badge, Box, Group, Menu, Text } from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsExchange,
  IconCheck,
  IconEye,
  IconLink,
} from "@tabler/icons-react";
import {
  STATUSES,
  STATUS_META,
  formatMeta,
  primaryTitle,
  type VideoStatus,
  type VideoView,
} from "@/lib/content-plan";

// Карточка ролика в колонке канбана. Клик открывает детальную панель.
// draggable + onDragStart/onDragEnd — для канбан-DnD (нативный HTML5).
export default function VideoCard({
  v,
  onOpen,
  draggable,
  onDragStart,
  onDragEnd,
  onStatus,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  v: VideoView;
  onOpen: () => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  // Смена статуса без перетаскивания: мышью не всегда удобно (и на тач-экране
  // нативного DnD нет вовсе), а ставить карточку нужно в ЛЮБУЮ колонку и в
  // любом порядке — меню это гарантирует.
  onStatus?: (status: VideoStatus) => void;
  // Сдвинуть карточку внутри колонки. ⚠️ Нужно не «для полноты»: нативного HTML5-DnD
  // на тач-экранах нет вовсе, и без этих пунктов порядок там не поменять никак.
  onMove?: (dir: "up" | "down") => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const fmt = formatMeta(v.format);
  const preview = v.previewTexts[0];
  return (
    <Box
      className="cp-card"
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", v.id);
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {v.thumbnail && <img className="cp-thumb" src={ytImage(v.thumbnail) ?? undefined} alt="" />}

      <Group gap={6} mb={6} wrap="nowrap" justify="space-between" align="flex-start">
        <Group gap={6} wrap="wrap">
          {fmt && (
            <Badge size="xs" variant="light" color={fmt.color} radius="sm">
              {fmt.label}
            </Badge>
          )}
          {v.noSpeaker && (
            <Badge size="xs" variant="light" color="gray" radius="sm">
              без спикера
            </Badge>
          )}
          {v.reference && (
            <Badge
              size="xs"
              variant="light"
              color="cyan"
              radius="sm"
              leftSection={<IconLink size={10} />}
              title={v.reference}
            >
              референс
            </Badge>
          )}
          {v.kind === "short" && (
            <Badge size="xs" variant="light" color="grape" radius="sm">
              Shorts
            </Badge>
          )}
        </Group>
        <Group gap={4} wrap="nowrap">
          {v.visp && (
            <Box className="cp-visp" aria-label="ВИСП">
              <span className={v.visp.v ? "on" : ""}>В</span>
              <span className={v.visp.i ? "on" : ""}>И</span>
              <span className={v.visp.s ? "on" : ""}>С</span>
              <span className={v.visp.p ? "on" : ""}>П</span>
            </Box>
          )}
          {onStatus && (
            <Menu withinPortal position="bottom-end" shadow="md" radius="md">
              <Menu.Target>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label="Перенести в другую колонку"
                  onClick={(e) => e.stopPropagation()}
                  // ⚠️ И клавиатуру тоже: без этого Enter на кнопке открывал меню
                  // И всплывал на карточку, которая по Enter открывает панель.
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <IconArrowsExchange size={15} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                {onMove && (
                  <>
                    <Menu.Label>Порядок в колонке</Menu.Label>
                    <Menu.Item
                      disabled={!canMoveUp}
                      leftSection={<IconArrowUp size={14} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMove("up");
                      }}
                    >
                      Выше
                    </Menu.Item>
                    <Menu.Item
                      disabled={!canMoveDown}
                      leftSection={<IconArrowDown size={14} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMove("down");
                      }}
                    >
                      Ниже
                    </Menu.Item>
                  </>
                )}
                <Menu.Label>Перенести в</Menu.Label>
                {STATUSES.map((s) => (
                  <Menu.Item
                    key={s}
                    disabled={s === v.status}
                    leftSection={
                      s === v.status ? <IconCheck size={14} /> : <Box w={14} h={14} />
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (s !== v.status) onStatus(s);
                    }}
                  >
                    {STATUS_META[s].label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>

      <Text fw={600} lh={1.25} lineClamp={3}>
        {primaryTitle(v)}
      </Text>

      {preview && (
        <Text size="xs" c="dimmed" mt={4} lineClamp={1}>
          превью: {preview}
        </Text>
      )}

      {(v.views != null || v.source !== "ai") && (
        <Group gap={10} mt={8} wrap="nowrap">
          {v.views != null && (
            <Group gap={3} wrap="nowrap">
              <IconEye size={13} color="var(--mantine-color-dimmed)" />
              <Text size="xs" c="dimmed">
                {v.views.toLocaleString("ru-RU")}
              </Text>
            </Group>
          )}
          {v.source === "manual" && (
            <Text size="xs" c="dimmed">
              вручную
            </Text>
          )}
          {v.source === "imported" && (
            <Text size="xs" c="dimmed">
              с канала
            </Text>
          )}
          {v.source === "competitor" && (
            <Text size="xs" c="dimmed">
              от конкурента
            </Text>
          )}
        </Group>
      )}
    </Box>
  );
}
