"use client";

import { useEffect, useState } from "react";
import {
  Title,
  Text,
  Stack,
  Group,
  Paper,
  SimpleGrid,
  ThemeIcon,
  SegmentedControl,
  Loader,
  Alert,
  Box,
} from "@mantine/core";
import { AreaChart, BarChart, LineChart, DonutChart } from "@mantine/charts";
import {
  IconCurrencyDollar,
  IconMessage,
  IconMessages,
  IconLetterCase,
  IconUsers,
  IconUserPlus,
  IconAlertCircle,
} from "@tabler/icons-react";
import type { DashboardData, TopUser } from "@/lib/stats";

// ── Форматтеры ────────────────────────────────────────────────────────────
const money = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
const compact = (n: number) =>
  new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const int = (n: number) => n.toLocaleString("ru-RU");

const CATEGORY_LABEL: Record<string, string> = {
  chat: "Болтовня",
  short: "Короткие видео",
  long: "Длинные видео",
  method: "Методика",
};
const providerLabel = (p: string) =>
  p === "glm" ? "GLM" : p === "claude" ? "Claude" : p === "openrouter" ? "OpenRouter" : p;
// «YYYY-MM-DD» → «DD.MM» для оси времени.
const shortDay = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

const RANGES = [
  { label: "7 дней", value: "7" },
  { label: "30 дней", value: "30" },
  { label: "90 дней", value: "90" },
];

export default function AdminDashboardPage() {
  const [days, setDays] = useState("30");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/stats?days=${days}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { data: DashboardData }) => {
        if (alive) setData(d.data);
      })
      .catch(() => alive && setError("Не удалось загрузить статистику"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [days]);

  const series = (data?.series ?? []).map((s) => ({
    date: shortDay(s.day),
    cost: Number(s.cost.toFixed(4)),
    tokens: s.tokens,
    requests: s.requests,
  }));

  const providerData = (data?.providers ?? [])
    .map((p) => ({
      name: providerLabel(p.provider),
      value: p.requests,
      color: p.provider === "glm" ? "blue.6" : "brand.6",
    }))
    .filter((p) => p.value > 0);

  const categoryData = (data?.categories ?? []).map((c) => ({
    category: CATEGORY_LABEL[c.category] ?? c.category,
    requests: c.requests,
  }));

  const isEmpty =
    data &&
    data.totals.requests === 0 &&
    data.totals.tokens === 0 &&
    data.totals.costUsd === 0;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <div>
          <Title order={2}>Дашборд</Title>
          <Text c="dimmed" size="sm" mt={4}>
            Потребление модели, активность и топ пользователей за период.
          </Text>
        </div>
        <SegmentedControl
          color="brand"
          radius="md"
          value={days}
          onChange={setDays}
          data={RANGES}
        />
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}

      {loading || !data ? (
        <Group justify="center" py={64}>
          <Loader color="brand" />
        </Group>
      ) : (
        <>
          {/* KPI */}
          <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="md">
            <Kpi icon={<IconCurrencyDollar size={18} />} label="Потрачено" value={money(data.totals.costUsd)} />
            <Kpi icon={<IconMessage size={18} />} label="Запросов" value={int(data.totals.requests)} />
            <Kpi icon={<IconMessages size={18} />} label="Чатов" value={int(data.totals.chats)} />
            <Kpi icon={<IconLetterCase size={18} />} label="Токенов" value={compact(data.totals.tokens)} />
            <Kpi icon={<IconUsers size={18} />} label="Активных" value={int(data.totals.activeUsers)} />
            <Kpi icon={<IconUserPlus size={18} />} label="Новых" value={int(data.totals.newUsers)} />
          </SimpleGrid>

          {isEmpty && (
            <Alert color="gray" variant="light" icon={<IconAlertCircle size={16} />}>
              За выбранный период запросов ещё не было — графики наполнятся, как только
              пользователи начнут общаться с ассистентом.
            </Alert>
          )}

          {/* Расходы по дням */}
          <ChartCard title="Расходы по дням, $">
            <AreaChart
              h={240}
              data={series}
              dataKey="date"
              series={[{ name: "cost", label: "Расходы", color: "brand.6" }]}
              curveType="monotone"
              withGradient
              withDots={false}
              valueFormatter={(v) => money(v)}
              gridAxis="y"
              tickLine="none"
            />
          </ChartCard>

          {/* Токены + запросы по дням */}
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <ChartCard title="Токены по дням">
              <LineChart
                h={220}
                data={series}
                dataKey="date"
                series={[{ name: "tokens", label: "Токены", color: "blue.6" }]}
                curveType="monotone"
                withDots={false}
                valueFormatter={(v) => compact(v)}
                gridAxis="y"
                tickLine="none"
              />
            </ChartCard>
            <ChartCard title="Запросы по дням">
              <BarChart
                h={220}
                data={series}
                dataKey="date"
                series={[{ name: "requests", label: "Запросы", color: "teal.6" }]}
                gridAxis="y"
                tickLine="none"
              />
            </ChartCard>
          </SimpleGrid>

          {/* Провайдеры + категории */}
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <ChartCard title="Запросы по движкам">
              {providerData.length === 0 ? (
                <EmptyHint />
              ) : (
                <Group justify="center" py="sm">
                  <DonutChart
                    h={200}
                    data={providerData}
                    withLabelsLine
                    withLabels
                    tooltipDataSource="segment"
                    chartLabel="Запросы"
                  />
                </Group>
              )}
            </ChartCard>
            <ChartCard title="Запросы по типу">
              {categoryData.length === 0 ? (
                <EmptyHint />
              ) : (
                <BarChart
                  h={200}
                  data={categoryData}
                  dataKey="category"
                  orientation="vertical"
                  series={[{ name: "requests", label: "Запросы", color: "grape.6" }]}
                  gridAxis="x"
                  tickLine="none"
                />
              )}
            </ChartCard>
          </SimpleGrid>

          {/* Топ пользователей */}
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <TopList title="Топ по запросам" rows={data.topByRequests} metric="requests" />
            <TopList title="Топ по тратам" rows={data.topBySpend} metric="cost" />
          </SimpleGrid>
        </>
      )}
    </Stack>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Group gap={8} mb={8} wrap="nowrap">
        <ThemeIcon variant="light" color="brand" radius="md" size="md">
          {icon}
        </ThemeIcon>
        <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: "0.03em" }}>
          {label}
        </Text>
      </Group>
      <Text fz={26} fw={700} style={{ letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Text>
    </Paper>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Text fw={600} size="sm" mb="md">
        {title}
      </Text>
      {children}
    </Paper>
  );
}

function EmptyHint() {
  return (
    <Box ta="center" py={48}>
      <Text size="sm" c="dimmed">
        Пока нет данных
      </Text>
    </Box>
  );
}

function TopList({
  title,
  rows,
  metric,
}: {
  title: string;
  rows: TopUser[];
  metric: "requests" | "cost";
}) {
  return (
    <Paper withBorder radius="md" p="md">
      <Text fw={600} size="sm" mb="md">
        {title}
      </Text>
      {rows.length === 0 ? (
        <EmptyHint />
      ) : (
        <Stack gap={10}>
          {rows.map((u, i) => (
            <Group key={u.userId} justify="space-between" wrap="nowrap" gap="sm">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <Text size="sm" c="dimmed" fw={600} w={18} ta="right" style={{ flexShrink: 0 }}>
                  {i + 1}
                </Text>
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={500} truncate>
                    {u.name}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {u.email}
                  </Text>
                </div>
              </Group>
              <Text
                size="sm"
                fw={700}
                style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
              >
                {metric === "cost" ? money(u.cost) : int(u.requests)}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
