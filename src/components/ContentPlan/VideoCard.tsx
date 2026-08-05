"use client";

import { Badge, Box, Group, Text } from "@mantine/core";
import { IconEye } from "@tabler/icons-react";
import { formatMeta, primaryTitle, type VideoView } from "@/lib/content-plan";

// Карточка ролика в колонке канбана. Клик открывает детальную панель.
// draggable + onDragStart/onDragEnd — для канбан-DnD (нативный HTML5).
export default function VideoCard({
  v,
  onOpen,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  v: VideoView;
  onOpen: () => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
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
      {v.thumbnail && <img className="cp-thumb" src={v.thumbnail} alt="" />}

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
          {v.kind === "short" && (
            <Badge size="xs" variant="light" color="grape" radius="sm">
              Shorts
            </Badge>
          )}
        </Group>
        {v.visp && (
          <Box className="cp-visp" aria-label="ВИСП">
            <span className={v.visp.v ? "on" : ""}>В</span>
            <span className={v.visp.i ? "on" : ""}>И</span>
            <span className={v.visp.s ? "on" : ""}>С</span>
            <span className={v.visp.p ? "on" : ""}>П</span>
          </Box>
        )}
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
        </Group>
      )}
    </Box>
  );
}
