"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowLeft, IconPrinter } from "@tabler/icons-react";
import { ytImage } from "@/lib/image-proxy";
import { apiYouTubeData, formatCount, formatFull } from "@/lib/youtube-client";
import type { YouTubeData, YouTubeVideo } from "@/lib/youtube-types";
import { buildMatrix, quadrantMeta } from "./PackagingMatrix";

// Отчёт по каналу для клиента продюсера.
//
// ⚠️ Это НЕ второй дашборд. Дашборд отвечает продюсеру на вопрос «что чинить» и
// набит инструментами; отчёт отвечает клиенту на вопрос «что было сделано и что
// с каналом» — человеческим языком, без матриц, переключателей и терминов. Всё,
// что нельзя объяснить клиенту одной фразой, сюда не попадает.
//
// ⚠️ PDF получается печатью браузера (см. комментарий на странице отчёта): в
// стандартных шрифтах PDF нет кириллицы, а тащить headless-браузер в образ ради
// одной кнопки — несоразмерно.

const PERIODS = [
  { value: "28", label: "Месяц" },
  { value: "90", label: "3 месяца" },
  { value: "365", label: "Год" },
];

export default function ChannelReport({ projectId }: { projectId: string }) {
  const [days, setDays] = useState(28);
  const [data, setData] = useState<YouTubeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiYouTubeData(projectId, days)
      .then((res) => {
        if (!alive) return;
        if (res.ok) setData(res.data);
        else setError(res.error);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [projectId, days]);

  const ch = data?.channel;
  const period = data?.period ?? null;

  // Что получилось и что просело — считаем из той же матрицы, что и в разделе
  // «Канал», но показываем СЛОВАМИ: клиенту диаграмма рассеяния ничего не скажет.
  const { works, fix } = useMemo(() => {
    const videos = data?.periodVideos ?? data?.videos ?? [];
    const { points } = buildMatrix(videos, data?.subsByVideo ?? null, "long");
    return {
      works: points.filter((p) => p.quadrant === "works").slice(0, 5),
      fix: points.filter((p) => p.quadrant !== "works").slice(0, 5),
    };
  }, [data]);

  if (loading) {
    return (
      <Center h="60vh">
        <Loader color="brand" />
      </Center>
    );
  }

  if (error || !data?.connected || !ch) {
    return (
      <Box maw={720} mx="auto" p="xl">
        <Alert color="orange" variant="light">
          {error ?? "Канал не подключён — отчёт собрать не из чего."}
        </Alert>
        <Button
          component={Link}
          href={`/${projectId}/channel`}
          variant="subtle"
          mt="md"
          leftSection={<IconArrowLeft size={16} />}
        >
          Назад в раздел «Канал»
        </Button>
      </Box>
    );
  }

  const periodLabel =
    days === 28 ? "за месяц" : days === 90 ? "за три месяца" : "за год";

  return (
    <Box maw={860} mx="auto" px="md" py="lg" className="report">
      {/* Панель управления — на печать не идёт (см. .report-controls в globals). */}
      <Group justify="space-between" mb="lg" className="report-controls" wrap="wrap" gap="sm">
        <Button
          component={Link}
          href={`/${projectId}/channel`}
          variant="subtle"
          size="sm"
          leftSection={<IconArrowLeft size={16} />}
        >
          Назад
        </Button>
        <Group gap="sm">
          <SegmentedControl
            size="xs"
            radius="md"
            color="brand"
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            data={PERIODS}
          />
          <Button
            size="sm"
            color="brand"
            leftSection={<IconPrinter size={16} />}
            onClick={() => window.print()}
          >
            Сохранить PDF
          </Button>
        </Group>
      </Group>

      <Stack gap="xl">
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
            Отчёт по каналу {periodLabel}
          </Text>
          <Group gap="md" wrap="nowrap" align="center">
            {ch.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ytImage(ch.thumbnail) ?? undefined}
                alt=""
                width={56}
                height={56}
                style={{ borderRadius: "50%", flexShrink: 0 }}
              />
            )}
            <Box>
              <Title order={2}>{ch.title}</Title>
              <Text size="sm" c="dimmed">
                {formatCount(ch.subscriberCount)} подписчиков · {formatCount(ch.videoCount)} роликов
              </Text>
            </Box>
          </Group>
        </Box>

        {/* Цифры периода. ⚠️ Каждая — с человеческой подписью: клиент не обязан
            знать, что такое «удержание», но должен понимать, стало лучше или хуже. */}
        {period && (
          <Box>
            <Title order={4} mb="sm">
              Что произошло {periodLabel}
            </Title>
            <Table withRowBorders={false} verticalSpacing="xs">
              <Table.Tbody>
                <ReportRow
                  label="Просмотров"
                  value={formatFull(period.current.views)}
                  delta={deltaOf(period.current.views, period.previous?.views ?? null)}
                />
                <ReportRow
                  label="Новых подписчиков"
                  value={formatFull(period.current.netSubscribers)}
                  delta={deltaOf(
                    period.current.netSubscribers,
                    period.previous?.netSubscribers ?? null
                  )}
                />
                <ReportRow
                  label="Досматривают в среднем"
                  value={`${Math.round(period.current.avgViewPercentage)}%`}
                  delta={deltaOf(
                    period.current.avgViewPercentage,
                    period.previous?.avgViewPercentage ?? null
                  )}
                  hint="какую часть ролика зритель смотрит до конца"
                />
                <ReportRow
                  label="Время просмотра"
                  value={`${formatFull(Math.round(period.current.minutes / 60))} ч`}
                  hint="сколько часов люди суммарно смотрели канал"
                />
              </Table.Tbody>
            </Table>
          </Box>
        )}

        {works.length > 0 && (
          <Box>
            <Title order={4} mb="sm">
              Что сработало
            </Title>
            <Text size="sm" c="dimmed" mb="sm">
              Эти ролики собрали больше просмотров, чем канал выдаёт обычно, и их при
              этом досматривают. Формат и подача рабочие — их и развиваем.
            </Text>
            <Stack gap="xs">
              {works.map((p) => (
                <VideoLine key={p.video.id} v={p.video} note={`${Math.round(p.retention)}% досмотр`} />
              ))}
            </Stack>
          </Box>
        )}

        {fix.length > 0 && (
          <Box>
            <Title order={4} mb="sm">
              Над чем работаем дальше
            </Title>
            <Stack gap="xs">
              {fix.map((p) => (
                <VideoLine
                  key={p.video.id}
                  v={p.video}
                  note={quadrantMeta("long")[p.quadrant].label}
                />
              ))}
            </Stack>
          </Box>
        )}

        {data.traffic && data.traffic.length > 0 && (
          <Box>
            <Title order={4} mb="sm">
              Откуда приходят зрители
            </Title>
            {/* ⚠️ Доли считаем ЗДЕСЬ: API отдаёт просмотры, а клиенту нужен
                процент — «половина зрителей приходит из рекомендаций» понятнее,
                чем «41 273 просмотра из рекомендаций». */}
            <Table withRowBorders={false} verticalSpacing={4}>
              <Table.Tbody>
                {(() => {
                  const total = data.traffic.reduce((n, t) => n + t.views, 0) || 1;
                  return data.traffic.slice(0, 6).map((t) => (
                    <Table.Tr key={t.source}>
                      <Table.Td>
                        <Text size="sm">{t.label}</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right", width: 80 }}>
                        <Text size="sm" fw={600}>
                          {Math.round((t.views / total) * 100)}%
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ));
                })()}
              </Table.Tbody>
            </Table>
          </Box>
        )}

        <Text size="xs" c="dimmed">
          Данные YouTube Analytics за выбранный период. Отчёт собран в VELIZHANIN&nbsp;AI.
        </Text>
      </Stack>
    </Box>
  );
}

function deltaOf(now: number, prev: number | null): number | null {
  if (prev == null || prev === 0) return null;
  return Math.round(((now - prev) / Math.abs(prev)) * 100);
}

function ReportRow({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: number | null;
  hint?: string;
}) {
  return (
    <Table.Tr>
      <Table.Td>
        <Text size="sm">{label}</Text>
        {hint && (
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        )}
      </Table.Td>
      <Table.Td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <Group gap={8} justify="flex-end" wrap="nowrap">
          <Text fw={700}>{value}</Text>
          {delta != null && (
            <Badge size="sm" variant="light" color={delta >= 0 ? "teal" : "red"} radius="sm">
              {delta >= 0 ? "+" : ""}
              {delta}%
            </Badge>
          )}
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

function VideoLine({ v, note }: { v: YouTubeVideo; note: string }) {
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      {v.thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ytImage(v.thumbnail) ?? undefined}
          alt=""
          width={72}
          loading="lazy"
          style={{ borderRadius: 6, flexShrink: 0, aspectRatio: "16 / 9", objectFit: "cover" }}
        />
      )}
      <Box style={{ minWidth: 0, flex: 1 }}>
        <Text size="sm" lineClamp={2}>
          {v.title}
        </Text>
        <Text size="xs" c="dimmed">
          {formatCount(v.viewCount)} просмотров · {note}
        </Text>
      </Box>
    </Group>
  );
}
