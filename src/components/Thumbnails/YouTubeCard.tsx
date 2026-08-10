"use client";

import { Box, Group, Text } from "@mantine/core";
import { IconCircleCheckFilled, IconDotsVertical } from "@tabler/icons-react";

// Превью в том виде, в каком его увидит зритель в ленте YouTube.
//
// Зачем так подробно: обложка сама по себе всегда выглядит нормально. Проблемы
// («текст не читается», «превью повторяет название», «лицо теряется») вылезают
// только в реальном окружении — рядом с названием в две строки, аватаркой канала,
// плашкой длительности и служебной строкой. Поэтому рисуем карточку целиком, а не
// просто картинку с подписью.
//
// Цифры (просмотры, «1 день назад») — заглушка-декорация: у черновика превью
// статистики нет и быть не может. Они нужны только чтобы глаз считывал карточку
// как ленту.
export default function YouTubeCard({
  src,
  title,
  channel,
  avatarUrl,
  duration,
}: {
  src: string;
  title: string;
  channel: string;
  avatarUrl?: string | null;
  duration?: string;
}) {
  return (
    <Box>
      <Box className="ytc-thumb">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={title || "превью"} className="ytc-img" />
        {duration && <span className="ytc-duration">{duration}</span>}
      </Box>

      <Group align="flex-start" gap={12} mt={10} wrap="nowrap">
        <Box className="ytc-avatar" aria-hidden>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="ytc-img" />
          ) : (
            <span className="ytc-avatar-letter">{(channel || "К").slice(0, 1)}</span>
          )}
        </Box>

        <Box style={{ minWidth: 0, flex: 1 }}>
          <Text className="ytc-title">{title || "Название ролика пока не задано"}</Text>
          <Group gap={4} wrap="nowrap" mt={4}>
            <Text size="xs" c="dimmed" truncate>
              {channel}
            </Text>
            <IconCircleCheckFilled size={12} className="ytc-verified" aria-hidden />
          </Group>
          <Text size="xs" c="dimmed">
            814 тыс. просмотров · 1 день назад
          </Text>
        </Box>

        <IconDotsVertical size={16} className="ytc-dots" aria-hidden />
      </Group>
    </Box>
  );
}
