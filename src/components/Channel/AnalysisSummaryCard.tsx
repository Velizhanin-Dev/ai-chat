"use client";

import { useEffect, useState } from "react";
import { Badge, Box, Button, Group, List, Loader, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconChartRadar, IconCircleCheck, IconSparkles } from "@tabler/icons-react";
import { apiChannelAnalyses } from "@/lib/youtube-client";
import { kindLabel, paramsFor, periodLabelFull } from "@/lib/channel-params";
import type { ChannelAnalysisRow } from "@/lib/youtube-types";
import ParamWheel from "./ParamWheel";

// Первая строка раздела: последний разбор канала — круг + вывод. Полный разбор
// (переключатели среза, детали параметров, история) живёт в модалке; здесь только
// итог, чтобы человек с порога видел, в каком состоянии канал.

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

interface Props {
  projectId: string;
  onOpen: () => void;
  // Тик: меняется, когда в модалке сделали новый разбор — перечитываем последний.
  refreshKey?: number;
}

export default function AnalysisSummaryCard({ projectId, onOpen, refreshKey = 0 }: Props) {
  const [row, setRow] = useState<ChannelAnalysisRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiChannelAnalyses(projectId).then((res) => {
      if (!alive) return;
      setRow(res.ok ? res.data[0] ?? null : null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId, refreshKey]);

  if (loading) {
    return (
      <Box className="an-surface" p="lg" style={{ display: "grid", placeItems: "center", minHeight: 220 }}>
        <Loader color="brand" size="sm" />
      </Box>
    );
  }

  if (!row) {
    return (
      <Box className="an-surface" p="lg" style={{ height: "100%" }}>
        <Stack gap="sm" align="flex-start" justify="center" style={{ height: "100%" }}>
          <ThemeIcon size={44} radius="xl" variant="light" color="brand">
            <IconChartRadar size={24} />
          </ThemeIcon>
          <Text fw={600}>Разбор канала не делали</Text>
          <Text size="sm" c="dimmed">
            Пройдусь по параметрам продвижения, сверю каждый с нормой и скажу, что чинить в первую
            очередь. Разбор сохранится — через месяц будет видно, что изменилось.
          </Text>
          <Button color="brand" leftSection={<IconSparkles size={16} />} onClick={onOpen}>
            Разобрать канал
          </Button>
        </Stack>
      </Box>
    );
  }

  const worst = [...row.result.params].sort((a, b) => a.score - b.score)[0];
  const worstLabel = paramsFor(row.kind).find((s) => s.key === worst?.key)?.label ?? "";

  return (
    <Box className="an-surface" p="lg" style={{ height: "100%" }}>
      <Group justify="space-between" mb="sm" wrap="nowrap" gap="xs">
        <Text fw={600}>Разбор канала</Text>
        <Badge variant="light" color="gray" radius="sm">
          {kindLabel(row.kind)}, {periodLabelFull(row.periodDays)}
        </Badge>
      </Group>

      <Group align="flex-start" gap="lg" wrap="nowrap" style={{ flexWrap: "wrap" }}>
        <Box style={{ flex: "0 0 200px", maxWidth: 220 }}>
          <ParamWheel
            params={row.result.params}
            specs={paramsFor(row.kind)}
            overall={row.overallScore}
            selected={null}
            onSelect={onOpen}
            values={Object.fromEntries(row.metrics.metrics.map((m) => [m.key, m.display]))}
            withLabels={false}
            animKey={row.id}
          />
        </Box>

        <Stack gap="xs" style={{ flex: "1 1 240px", minWidth: 0 }}>
          {worst && (
            <Text size="sm">
              Сильнее всего проседает{" "}
              <Text span fw={600}>
                {worstLabel.toLowerCase()}
              </Text>{" "}
              — {worst.score} из 100.
            </Text>
          )}
          {row.result.priority.length > 0 && (
            <List
              size="sm"
              spacing={4}
              icon={<IconCircleCheck size={15} color="var(--mantine-color-brand-6)" />}
            >
              {row.result.priority.slice(0, 3).map((p, i) => (
                <List.Item key={i}>{p}</List.Item>
              ))}
            </List>
          )}
          <Group gap="xs" mt="auto">
            <Button size="xs" variant="light" color="brand" onClick={onOpen}>
              Смотреть разбор
            </Button>
            <Text size="xs" c="dimmed">
              от {formatWhen(row.createdAt)}
            </Text>
          </Group>
        </Stack>
      </Group>
    </Box>
  );
}
