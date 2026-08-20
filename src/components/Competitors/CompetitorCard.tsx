"use client";

import { ytImage } from "@/lib/image-proxy";

import { ActionIcon, Badge, Box, Group, Paper, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconExternalLink,
  IconFlame,
  IconPlaylistAdd,
  IconUsers,
  IconUserPlus,
  IconCheck,
} from "@tabler/icons-react";
import { formatRatio, type CompetitorVideo } from "@/lib/competitors";
import { formatCount, formatDuration, formatShortDate } from "@/lib/youtube-client";

// Карточка чужого ролика. Используется на ОБЕИХ страницах — и в поиске референсов,
// и в списке конкурентов, — поэтому вынесена из доски в свой файл.
export default function CompetitorCard({
  video,
  onAddToPlan,
  onAddChannel,
  addingChannel,
  addedChannel,
}: {
  video: CompetitorVideo;
  onAddToPlan: (v: CompetitorVideo) => void;
  /** «В конкуренты»: добавить КАНАЛ этого ролика в список на соседней странице. */
  onAddChannel?: (v: CompetitorVideo) => void;
  addingChannel?: boolean;
  /** Канал уже в списке конкурентов — кнопка гаснет, чтобы не жать вслепую. */
  addedChannel?: boolean;
}) {
  // ⚠️ Кнопка «в контент-план» — СОСЕД ссылки, а не её потомок. Раньше вся карточка
  // была одним <a>, и кнопка лежала внутри него: браузер такое дерево при разборе
  // перестраивает (интерактив внутри ссылки невалиден), обработчик клика к кнопке
  // не привязывался — модалка молча не открывалась. Ловили вживую.
  return (
    <Paper
      className="an-surface yt-video-card"
      style={{ overflow: "hidden", position: "relative" }}
    >
      <a
        href={`https://www.youtube.com/watch?v=${video.id}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: "block", color: "inherit", textDecoration: "none" }}
      >
        <Box
          className="yt-thumb"
          style={{
            position: "relative",
            aspectRatio: "16 / 9",
            background: "var(--mantine-color-dark-4)",
          }}
        >
          {video.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ytImage(video.thumbnail) ?? undefined}
              alt={video.title}
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          )}

          {/* Главная цифра карточки — во сколько раз просмотры обогнали подписчиков.
              Размер поднят в полтора раза против стандартного бейджа: это не подпись,
              а то, ради чего карточку вообще смотрят. */}
          <Badge
            leftSection={<IconFlame size={19} />}
            radius="sm"
            style={{
              position: "absolute",
              left: 8,
              top: 8,
              height: 30,
              paddingInline: 12,
              fontSize: "1rem",
              background: "var(--mantine-color-brand-filled)",
              color: "#fff",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatRatio(video.ratio)}
          </Badge>

          {/* Тип ролика: у шортса и лонга разная природа охвата, и по одной
              длительности это читается не сразу. ≤180 с — шортс (YouTube поднял
              планку до 3 минут). */}
          <Badge
            radius="sm"
            size="sm"
            variant="filled"
            color={video.isShort ? "grape" : "dark"}
            style={{ position: "absolute", left: 8, bottom: 8 }}
          >
            {video.isShort ? "Shorts" : "Видео"}
          </Badge>

          {video.duration && (
            <Badge
              radius="sm"
              size="sm"
              style={{
                position: "absolute",
                right: 8,
                bottom: 8,
                background: "rgba(0,0,0,0.82)",
                color: "#fff",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatDuration(video.duration)}
            </Badge>
          )}
        </Box>

        <Stack gap={6} p="sm">
          <Text fw={600} size="sm" lineClamp={2} title={video.title}>
            {video.title}
          </Text>

          <Group gap={6} wrap="nowrap">
            {video.channelThumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ytImage(video.channelThumb) ?? undefined}
                alt=""
                width={18}
                height={18}
                style={{ borderRadius: "50%", flexShrink: 0 }}
              />
            )}
            <Text size="xs" c="dimmed" truncate>
              {video.channelTitle}
            </Text>
          </Group>

          <Group gap="xs" wrap="wrap">
            <Text size="xs" c="dimmed">
              {formatCount(video.views)} просмотров
            </Text>
            <Group gap={3} wrap="nowrap">
              <IconUsers size={12} style={{ color: "var(--mantine-color-dimmed)" }} />
              <Text size="xs" c="dimmed">
                {formatCount(video.subscribers)}
              </Text>
            </Group>
            {video.publishedAt && (
              <Text size="xs" c="dimmed">
                {formatShortDate(video.publishedAt)}
              </Text>
            )}
            <IconExternalLink size={12} style={{ color: "var(--mantine-color-dimmed)" }} />
          </Group>

          {video.query && (
            <Text size="xs" c="dimmed" truncate title={`Найден по запросу: ${video.query}`}>
              по запросу «{video.query}»
            </Text>
          )}
        </Stack>
      </a>

      {/* Кнопки поверх превью, но ВНЕ ссылки — иначе клик по ним не работает (см. выше). */}
      {onAddChannel && (
        <Tooltip
          label={addedChannel ? "Канал уже в конкурентах" : "Добавить канал в конкуренты"}
          withArrow
        >
          <ActionIcon
            variant="filled"
            color={addedChannel ? "teal" : "dark"}
            radius="md"
            size="lg"
            loading={addingChannel}
            disabled={addedChannel}
            aria-label="Добавить канал в конкуренты"
            onClick={() => onAddChannel(video)}
            style={{ position: "absolute", right: 8, top: 52, zIndex: 2 }}
          >
            {addedChannel ? <IconCheck size={18} /> : <IconUserPlus size={18} />}
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label="Добавить референсом в контент-план" withArrow>
        <ActionIcon
          variant="filled"
          color="dark"
          radius="md"
          size="lg"
          aria-label="Добавить референсом в контент-план"
          onClick={() => onAddToPlan(video)}
          style={{ position: "absolute", right: 8, top: 8, zIndex: 2 }}
        >
          <IconPlaylistAdd size={18} />
        </ActionIcon>
      </Tooltip>
    </Paper>
  );
}
