"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  CopyButton,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { AreaChart, BarChart, DonutChart } from "@mantine/charts";
import {
  IconBrandYoutube,
  IconUsers,
  IconEye,
  IconVideo,
  IconClock,
  IconUserPlus,
  IconChartArcs,
  IconThumbUp,
  IconMessageCircle,
  IconRefresh,
  IconAlertCircle,
  IconPlugConnected,
  IconExternalLink,
  IconArrowUpRight,
  IconArrowDownRight,
  IconPencil,
  IconSparkles,
  IconCopy,
  IconCircleCheck,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { bumpRequestsUsed } from "@/store/authSlice";
import {
  apiYouTubeData,
  apiAnalyzeVideo,
  getVideoDetailCached,
  prefetchVideoDetail,
  writeHookPrompt,
  formatCount,
  formatFull,
  formatDuration,
  formatDate,
  formatShortDate,
  formatWatchTime,
  formatSeconds,
  growthPct,
  formatDeltaPct,
  formatDeltaPoints,
} from "@/lib/youtube-client";
import {
  PERIOD_DAYS,
  type YouTubeData,
  type YouTubeVideo,
  type PeriodComparison,
  type VideoDetail,
  type VideoAnalysis,
  type TrafficSource,
  type SubscriberDynamics as SubscriberDynamicsData,
  type SubscriberVideo,
  type AudienceData,
} from "@/lib/youtube-types";

// Подпись периода для заголовков/капшенов.
function periodLabel(days: number): string {
  return days === 365 ? "за год" : `за ${days} дней`;
}
const PERIOD_OPTIONS = PERIOD_DAYS.map((d) => ({
  value: String(d),
  label: d === 365 ? "Год" : `${d} дн.`,
}));

type Phase =
  | { s: "loading" }
  | { s: "disconnected" }
  | { s: "reauth" }
  | { s: "error"; msg: string }
  | { s: "ready"; data: YouTubeData };

export default function ChannelDashboard() {
  const params = useParams();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  const settingsHref = projectId ? `/${projectId}/settings` : "/app";

  const [phase, setPhase] = useState<Phase>({ s: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<number>(28);

  const load = useCallback(
    async (soft: boolean) => {
      if (soft) setRefreshing(true);
      else setPhase({ s: "loading" });
      const res = await apiYouTubeData(projectId, period);
      setRefreshing(false);
      if (!res.ok) {
        if (res.code === "YT_REAUTH") setPhase({ s: "reauth" });
        else setPhase({ s: "error", msg: res.error });
        return;
      }
      if (!res.data.connected) setPhase({ s: "disconnected" });
      else setPhase({ s: "ready", data: res.data });
    },
    [projectId, period]
  );

  // Первый заход (и смена проекта) — полный skeleton; смена периода — мягкий
  // рефреш (карточки остаются, крутится индикатор), чтобы не мигать дашбордом.
  const first = useRef(true);
  useEffect(() => {
    const soft = !first.current;
    first.current = false;
    load(soft);
  }, [load]);

  return (
    <Box style={{ flex: 1, minHeight: 0, overflowY: "auto" }} py="md">
      <Box px={{ base: "xs", sm: "md" }}>
        <Group justify="space-between" mb="md" wrap="nowrap" gap="sm">
          <Title order={2} fz={{ base: "1.35rem", sm: "1.75rem" }}>
            Канал
          </Title>
          {phase.s === "ready" && (
            <Group gap="sm" wrap="nowrap">
              <SegmentedControl
                size="sm"
                radius="md"
                color="brand"
                value={String(period)}
                onChange={(v) => setPeriod(Number(v))}
                data={PERIOD_OPTIONS}
                disabled={refreshing}
                aria-label="Период аналитики"
              />
              <Tooltip label="Обновить данные" withArrow>
                <ActionIcon
                  variant="light"
                  color="brand"
                  size="lg"
                  radius="md"
                  onClick={() => load(true)}
                  loading={refreshing}
                  aria-label="Обновить данные канала"
                >
                  <IconRefresh size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
        </Group>

        {phase.s === "loading" && <DashboardSkeleton />}
        {phase.s === "disconnected" && <NotConnected settingsHref={settingsHref} />}
        {phase.s === "reauth" && (
          <Reauth settingsHref={settingsHref} onRetry={() => load(false)} />
        )}
        {phase.s === "error" && <ErrorState msg={phase.msg} onRetry={() => load(false)} />}
        {phase.s === "ready" && <Dashboard data={phase.data} />}
      </Box>
    </Box>
  );
}

// ── Загруженный дашборд ───────────────────────────────────────────────────────

function Dashboard({ data }: { data: YouTubeData }) {
  const params = useParams();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  const ch = data.channel;
  const videos = data.videos ?? [];
  const daily = data.daily ?? null;
  const period = data.period ?? null;

  // Выбранное видео для детальной панели (кривая удержания).
  const [selected, setSelected] = useState<YouTubeVideo | null>(null);

  if (!ch) return null;

  return (
    <Stack gap="lg">
      {/* Шапка канала */}
      <Paper withBorder radius="lg" style={{ overflow: "hidden" }}>
        <Box
          style={{
            height: 132,
            background: ch.banner
              ? `center / cover no-repeat url("${ch.banner}=w1280")`
              : "linear-gradient(120deg, var(--mantine-color-brand-6), var(--mantine-color-brand-8))",
          }}
        />
        <Group
          gap="md"
          wrap="nowrap"
          align="flex-end"
          px={{ base: "md", sm: "lg" }}
          pb="md"
          style={{ marginTop: -36 }}
        >
          <Avatar
            src={ch.thumbnail}
            size={88}
            radius="50%"
            color="red"
            style={{ border: "4px solid var(--mantine-color-body)", flexShrink: 0 }}
          >
            <IconBrandYoutube size={44} />
          </Avatar>
          <Box style={{ minWidth: 0, paddingBottom: 4 }}>
            <Title order={3} fz={{ base: "1.15rem", sm: "1.4rem" }} lineClamp={1}>
              {ch.title}
            </Title>
            <Group gap="xs" wrap="wrap">
              {ch.customUrl && (
                <Anchor
                  href={`https://www.youtube.com/${ch.customUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  size="sm"
                  c="dimmed"
                >
                  <Group gap={4} wrap="nowrap">
                    {ch.customUrl}
                    <IconExternalLink size={12} />
                  </Group>
                </Anchor>
              )}
              {!ch.hiddenSubscriberCount && (
                <Text size="sm" c="dimmed">
                  {formatCount(ch.subscriberCount)} подписчиков
                </Text>
              )}
              <Text size="sm" c="dimmed">
                · {formatCount(ch.viewCount)} просмотров
              </Text>
              <Text size="sm" c="dimmed">
                · {formatCount(ch.videoCount)} видео
              </Text>
            </Group>
          </Box>
        </Group>
        {ch.description && (
          <Text size="sm" c="dimmed" px={{ base: "md", sm: "lg" }} pb="md" lineClamp={2}>
            {ch.description}
          </Text>
        )}
      </Paper>

      {/* KPI-карточки: метрики за период с дельтой роста vs прошлый период */}
      {period ? (
        <PeriodKpis period={period} />
      ) : (
        // Аналитика недоступна — показываем лайфтайм-тоталы без дельт.
        <SimpleGrid cols={{ base: 2, md: 3 }} spacing="md">
          <StatCard
            icon={<IconUsers size={20} />}
            label="Подписчики"
            value={ch.hiddenSubscriberCount ? "—" : formatCount(ch.subscriberCount)}
            full={ch.hiddenSubscriberCount ? "Скрыто" : formatFull(ch.subscriberCount)}
            color="brand"
          />
          <StatCard
            icon={<IconEye size={20} />}
            label="Просмотры всего"
            value={formatCount(ch.viewCount)}
            full={formatFull(ch.viewCount)}
            color="blue"
          />
          <StatCard
            icon={<IconVideo size={20} />}
            label="Видео"
            value={formatCount(ch.videoCount)}
            full={formatFull(ch.videoCount)}
            color="grape"
          />
        </SimpleGrid>
      )}

      {/* График просмотров */}
      {daily && daily.length > 0 && (
        <Paper withBorder radius="lg" p="md">
          <Text fw={600} mb="md">
            Просмотры {periodLabel(period?.days ?? 28)}
          </Text>
          <AreaChart
            h={240}
            data={daily.map((d) => ({
              date: formatShortDate(d.date),
              Просмотры: d.views,
            }))}
            dataKey="date"
            series={[{ name: "Просмотры", color: "brand.6" }]}
            curveType="monotone"
            withGradient
            withDots={false}
            valueFormatter={(v) => formatFull(v)}
            gridAxis="y"
            tickLine="none"
          />
        </Paper>
      )}

      {/* Источники трафика */}
      {data.traffic && data.traffic.length > 0 && (
        <TrafficSources traffic={data.traffic} days={period?.days ?? 28} />
      )}

      {/* Динамика подписчиков */}
      {data.subscribers &&
        (data.subscribers.topVideos.length > 0 ||
          data.subscribers.daily.some((d) => d.gained > 0 || d.lost > 0)) && (
          <SubscriberSection sub={data.subscribers} days={period?.days ?? 28} />
        )}

      {/* Аудитория */}
      {data.audience && <AudienceSection a={data.audience} days={period?.days ?? 28} />}

      {/* Последние видео */}
      <Box>
        <Text fw={600} mb="md">
          Последние видео
        </Text>
        {videos.length === 0 ? (
          <Text size="sm" c="dimmed">
            На канале пока нет опубликованных видео.
          </Text>
        ) : (
          <SimpleGrid cols={{ base: 1, xs: 2, sm: 3, lg: 4, xl: 5 }} spacing="md">
            {videos.map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                onOpen={setSelected}
                onPrefetch={() => prefetchVideoDetail(projectId, v.id, v.publishedAt)}
              />
            ))}
          </SimpleGrid>
        )}
      </Box>

      <VideoDetailModal
        video={selected}
        projectId={projectId}
        onClose={() => setSelected(null)}
      />
    </Stack>
  );
}

function StatCard({
  icon,
  label,
  value,
  full,
  color,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  full: string;
  color: string;
  trend?: React.ReactNode;
}) {
  return (
    <Tooltip label={full} withArrow openDelay={200}>
      <Paper withBorder radius="lg" p="md">
        <Group gap="xs" mb={10} wrap="nowrap">
          <ThemeIcon variant="light" color={color} radius="md" size={32}>
            {icon}
          </ThemeIcon>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {label}
          </Text>
        </Group>
        <Text
          fz={{ base: "1.6rem", sm: "1.9rem" }}
          fw={700}
          lh={1.1}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </Text>
        {trend && <Box mt={6}>{trend}</Box>}
      </Paper>
    </Tooltip>
  );
}

// KPI за период: просмотры, время просмотра, новые подписчики (net), ср. % досмотра —
// с дельтой роста относительно предыдущего равного периода.
function PeriodKpis({ period }: { period: PeriodComparison }) {
  const { current: c, previous: p } = period;
  const suffix = periodLabel(period.days);
  return (
    <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
      <StatCard
        icon={<IconEye size={20} />}
        label={`Просмотры ${suffix}`}
        value={formatCount(c.views)}
        full={formatFull(c.views)}
        color="brand"
        trend={<DeltaInline pct={growthPct(c.views, p?.views)} />}
      />
      <StatCard
        icon={<IconClock size={20} />}
        label={`Время просмотра ${suffix}`}
        value={formatWatchTime(c.minutes)}
        full={`${formatFull(Math.round(c.minutes))} минут`}
        color="blue"
        trend={<DeltaInline pct={growthPct(c.minutes, p?.minutes)} />}
      />
      <StatCard
        icon={<IconUserPlus size={20} />}
        label={`Подписчики ${suffix}`}
        value={`${c.netSubscribers >= 0 ? "+" : "−"}${formatCount(Math.abs(c.netSubscribers))}`}
        full={`Пришло ${formatFull(c.subscribersGained)}, ушло ${formatFull(c.subscribersLost)}`}
        color="teal"
        trend={<DeltaInline pct={growthPct(c.netSubscribers, p?.netSubscribers)} />}
      />
      <StatCard
        icon={<IconChartArcs size={20} />}
        label={`Ср. % досмотра ${suffix}`}
        value={`${Math.round(c.avgViewPercentage)}%`}
        full={`Средний процент досмотра ролика ${suffix}`}
        color="grape"
        trend={
          p ? (
            <DeltaInline
              text={formatDeltaPoints(c.avgViewPercentage - p.avgViewPercentage)}
              up={c.avgViewPercentage - p.avgViewPercentage >= 0}
              neutral={Math.round((c.avgViewPercentage - p.avgViewPercentage) * 10) === 0}
            />
          ) : (
            <DeltaInline />
          )
        }
      />
    </SimpleGrid>
  );
}

// Инлайн-дельта внутри карточки (без пилюли): цветная стрелка + значение + тихий
// капшен «за пред. период». Цвет текста — из Mantine light-color переменной
// (адаптив к теме, контраст ≥4.5:1). Принимает процент (pct) или готовый text +
// направление (для процентных пунктов). Нет прошлого периода → тихий «нет данных».
function DeltaInline({
  pct,
  text,
  up,
  neutral,
}: {
  pct?: number | null;
  text?: string;
  up?: boolean;
  neutral?: boolean;
}) {
  if (text === undefined) {
    if (pct == null) {
      return (
        <Text size="xs" c="dimmed">
          нет данных за пред. период
        </Text>
      );
    }
    const rounded = Math.round(pct);
    return <DeltaInline text={formatDeltaPct(pct)} up={rounded > 0} neutral={rounded === 0} />;
  }
  const c = neutral ? "gray" : up ? "teal" : "red";
  const Icon = up ? IconArrowUpRight : IconArrowDownRight;
  return (
    <Group gap={5} wrap="nowrap" align="center">
      <Box
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          color: `var(--mantine-color-${c}-light-color)`,
          fontWeight: 700,
          fontSize: "0.9375rem",
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {!neutral && <Icon size={16} stroke={2.5} />}
        {text}
      </Box>
      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
        за пред. период
      </Text>
    </Group>
  );
}

// Цвет прогресс-бара удержания по порогам (методика: низкое = «чинить хук»).
function retentionColor(pct: number): string {
  if (pct >= 45) return "teal";
  if (pct >= 25) return "yellow";
  return "red";
}

// ── Источники трафика: donut + список с долями ────────────────────────────────

const TRAFFIC_COLORS: Record<string, string> = {
  RELATED_VIDEO: "brand.6",
  YT_SEARCH: "blue.6",
  BROWSE: "teal.6",
  EXT_URL: "grape.6",
  PLAYLIST: "orange.6",
  SHORTS: "pink.6",
  SUBSCRIBER: "cyan.6",
  NOTIFICATION: "lime.6",
  YT_CHANNEL: "indigo.6",
  END_SCREEN: "yellow.6",
  __OTHER__: "gray.5",
};
const TRAFFIC_FALLBACK = ["violet.6", "green.6", "red.6", "teal.8", "blue.8", "grape.8"];
function trafficColor(source: string, i: number): string {
  return TRAFFIC_COLORS[source] ?? TRAFFIC_FALLBACK[i % TRAFFIC_FALLBACK.length];
}

function TrafficSources({ traffic, days }: { traffic: TrafficSource[]; days: number }) {
  const total = traffic.reduce((s, t) => s + t.views, 0);
  const withColor = traffic.map((t, i) => ({ ...t, color: trafficColor(t.source, i) }));
  const donutData = withColor.map((t) => ({ name: t.label, value: t.views, color: t.color }));

  return (
    <Paper withBorder radius="lg" p="md">
      <Text fw={600} mb="md">
        Источники трафика {periodLabel(days)}
      </Text>
      <Group align="center" gap="xl" wrap="wrap">
        <DonutChart
          data={donutData}
          size={190}
          thickness={26}
          withTooltip
          tooltipDataSource="segment"
          valueFormatter={(v) => `${formatFull(v)} просмотров`}
          chartLabel={total > 0 ? formatCount(total) : undefined}
          mx="auto"
        />
        <Stack gap="sm" style={{ flex: 1, minWidth: 240 }}>
          {withColor.map((t) => (
            <Box key={t.source}>
              <Group justify="space-between" wrap="nowrap" mb={4} gap="xs">
                <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Box
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: `var(--mantine-color-${t.color.replace(".", "-")})`,
                      flexShrink: 0,
                    }}
                  />
                  <Text size="sm" truncate>
                    {t.label}
                  </Text>
                </Group>
                <Text size="sm" fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {total > 0 ? Math.round((t.views / total) * 100) : 0}%
                </Text>
              </Group>
              <Progress
                value={total > 0 ? (t.views / total) * 100 : 0}
                color={t.color}
                size="sm"
                radius="xl"
              />
            </Box>
          ))}
        </Stack>
      </Group>
      <Text size="xs" c="dimmed" mt="md">
        Больше «Рекомендованных» — заходят превью и заголовки (ВИСП); больше «Поиска» — работает
        SEO-название ролика.
      </Text>
    </Paper>
  );
}

// ── Динамика подписчиков: пришло/ушло по дням + видео-драйверы ─────────────────

function SubscriberSection({ sub, days }: { sub: SubscriberDynamicsData; days: number }) {
  const totalGained = sub.daily.reduce((s, d) => s + d.gained, 0);
  const totalLost = sub.daily.reduce((s, d) => s + d.lost, 0);
  const net = totalGained - totalLost;
  const hasActivity = totalGained > 0 || totalLost > 0;
  // «Ушло» — отрицательными, чтобы столбцы шли вниз (расходящиеся столбцы).
  const chartData = sub.daily.map((d) => ({
    date: formatShortDate(d.date),
    Пришло: d.gained,
    Ушло: -d.lost,
  }));

  return (
    <Paper withBorder radius="lg" p="md">
      <Group justify="space-between" mb="md" wrap="nowrap" gap="sm">
        <Text fw={600}>Подписчики {periodLabel(days)}</Text>
        <Group gap="sm" wrap="nowrap">
          <Text size="sm" c="teal" fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>
            +{formatCount(totalGained)}
          </Text>
          <Text size="sm" c="red" fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>
            −{formatCount(totalLost)}
          </Text>
          <Badge color={net >= 0 ? "teal" : "red"} variant="light" radius="sm">
            чистыми {net >= 0 ? "+" : "−"}
            {formatCount(Math.abs(net))}
          </Badge>
        </Group>
      </Group>

      {hasActivity ? (
        <BarChart
          h={220}
          data={chartData}
          dataKey="date"
          type="stacked"
          series={[
            { name: "Пришло", color: "teal.6" },
            { name: "Ушло", color: "red.6" },
          ]}
          withLegend
          gridAxis="y"
          tickLine="none"
          valueFormatter={(v) => String(Math.abs(v))}
        />
      ) : (
        <Text size="sm" c="dimmed">
          За период подписки почти не менялись.
        </Text>
      )}

      {sub.topVideos.length > 0 && (
        <Box mt="lg">
          <Text fw={600} mb="sm">
            Видео, приносящие подписчиков
          </Text>
          <Stack gap="sm">
            {sub.topVideos.map((v) => (
              <SubVideoRow key={v.id} v={v} />
            ))}
          </Stack>
        </Box>
      )}
    </Paper>
  );
}

function SubVideoRow({ v }: { v: SubscriberVideo }) {
  return (
    <Anchor
      href={`https://www.youtube.com/watch?v=${v.id}`}
      target="_blank"
      rel="noreferrer"
      underline="never"
      c="inherit"
      display="block"
    >
      <Group gap="sm" wrap="nowrap">
        <Box
        style={{
          width: 76,
          aspectRatio: "16 / 9",
          borderRadius: 8,
          overflow: "hidden",
          flexShrink: 0,
          background: "var(--mantine-color-dark-4)",
        }}
      >
        {v.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={v.thumbnail}
            alt=""
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}
      </Box>
      <Text size="sm" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
        {v.title}
      </Text>
        <Tooltip label={`Пришло ${formatFull(v.gained)}, ушло ${formatFull(v.lost)}`} withArrow>
          <Text
            size="sm"
            fw={700}
            c={v.net >= 0 ? "teal" : "red"}
            style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
          >
            {v.net >= 0 ? "+" : "−"}
            {formatCount(Math.abs(v.net))}
          </Text>
        </Tooltip>
      </Group>
    </Anchor>
  );
}

// ── Аудитория: возраст / пол / гео / устройства ───────────────────────────────

function AudienceSection({ a, days }: { a: AudienceData; days: number }) {
  const blocks = [
    { title: "Возраст", items: a.age.map((x) => ({ label: x.group, pct: x.pct })) },
    { title: "Пол", items: a.gender.map((x) => ({ label: x.label, pct: x.pct })) },
    { title: "География", items: a.geo.map((x) => ({ label: x.label, pct: x.pct })) },
    { title: "Устройства", items: a.devices.map((x) => ({ label: x.label, pct: x.pct })) },
  ].filter((b) => b.items.length > 0);

  return (
    <Paper withBorder radius="lg" p="md">
      <Text fw={600} mb="md">
        Аудитория {periodLabel(days)}
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="xl">
        {blocks.map((b) => (
          <AudienceBars key={b.title} title={b.title} items={b.items} />
        ))}
      </SimpleGrid>
      <Text size="xs" c="dimmed" mt="md">
        Сверь с ЦА, которую закладывал в брифе проекта — попадаешь ли в свою аудиторию.
      </Text>
    </Paper>
  );
}

function AudienceBars({
  title,
  items,
}: {
  title: string;
  items: { label: string; pct: number }[];
}) {
  return (
    <Box>
      <Text fw={600} size="sm" mb="xs">
        {title}
      </Text>
      <Stack gap="xs">
        {items.map((it, i) => (
          <Box key={i}>
            <Group justify="space-between" mb={2} gap="xs" wrap="nowrap">
              <Text size="sm" truncate>
                {it.label}
              </Text>
              <Text size="sm" fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>
                {Math.round(it.pct)}%
              </Text>
            </Group>
            <Progress value={it.pct} color="brand" size="sm" radius="xl" />
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function VideoCard({
  video,
  onOpen,
  onPrefetch,
}: {
  video: YouTubeVideo;
  onOpen: (v: YouTubeVideo) => void;
  onPrefetch: () => void;
}) {
  return (
    <Paper
      withBorder
      radius="lg"
      className="yt-video-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(video)}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(video);
        }
      }}
      style={{ overflow: "hidden", display: "block", color: "inherit" }}
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
            src={video.thumbnail}
            alt={video.title}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}
        {video.duration && (
          <Badge
            color="dark"
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
      <Box p="sm">
        <Text fw={500} lineClamp={2} mb={8} style={{ minHeight: "2.6em" }}>
          {video.title}
        </Text>

        {/* Удержание — ключевая метрика методики (ср. % досмотра + ср. длит. просмотра) */}
        {video.avgViewPercentage != null && (
          <Box mb={10}>
            <Group justify="space-between" mb={4} wrap="nowrap" gap="xs">
              <Text size="xs" c="dimmed">
                Удержание
              </Text>
              <Text size="xs" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
                {Math.round(video.avgViewPercentage)}%
                {video.avgViewDuration != null && (
                  <Text span size="xs" c="dimmed" fw={400}>
                    {" "}
                    · ср. {formatSeconds(video.avgViewDuration)}
                  </Text>
                )}
              </Text>
            </Group>
            <Progress
              value={Math.min(100, video.avgViewPercentage)}
              color={retentionColor(video.avgViewPercentage)}
              size="sm"
              radius="xl"
            />
          </Box>
        )}

        <Group gap="md" wrap="wrap">
          <VideoStat icon={<IconEye size={14} />} value={formatCount(video.viewCount)} />
          <VideoStat icon={<IconThumbUp size={14} />} value={formatCount(video.likeCount)} />
          <VideoStat
            icon={<IconMessageCircle size={14} />}
            value={formatCount(video.commentCount)}
          />
          {video.watchMinutes != null && video.watchMinutes > 0 && (
            <VideoStat
              icon={<IconClock size={14} />}
              value={formatWatchTime(video.watchMinutes)}
            />
          )}
        </Group>

        {video.publishedAt && (
          <Text size="xs" c="dimmed" mt={8}>
            {formatDate(video.publishedAt)}
          </Text>
        )}
      </Box>
    </Paper>
  );
}

function VideoStat({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <Group gap={4} wrap="nowrap" c="dimmed">
      {icon}
      <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Text>
    </Group>
  );
}

// ── Детальная панель видео: кривая удержания + «переписать хук» ────────────────

type DetailState =
  | { s: "loading" }
  | { s: "ready"; detail: VideoDetail }
  | { s: "error"; msg: string };

function VideoDetailModal({
  video,
  projectId,
  onClose,
}: {
  video: YouTubeVideo | null;
  projectId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const userId = useAppSelector((s) => s.auth.user?.id ?? "");
  const [state, setState] = useState<DetailState>({ s: "loading" });

  const videoId = video?.id ?? null;
  const publishedAt = video?.publishedAt;
  useEffect(() => {
    if (!videoId) return;
    let alive = true;
    setState({ s: "loading" });
    // Кэш+prefetch: если карточку наводили, промис уже готов → откроется мгновенно.
    getVideoDetailCached(projectId, videoId, publishedAt).then((res) => {
      if (!alive) return;
      setState(res.ok ? { s: "ready", detail: res.data } : { s: "error", msg: res.error });
    });
    return () => {
      alive = false;
    };
  }, [videoId, projectId, publishedAt]);

  const rewriteHook = () => {
    if (!video) return;
    writeHookPrompt(userId, video.title);
    router.push(`/${projectId}/chat`);
  };

  return (
    <Modal
      opened={video != null}
      onClose={onClose}
      size="xl"
      radius="lg"
      centered
      title={
        <Text fw={600} lineClamp={2} pr="md">
          {video?.title}
        </Text>
      }
    >
      {video && (
        <Stack gap="md">
          <Group gap="lg" wrap="wrap">
            <VideoStat
              icon={<IconEye size={16} />}
              value={`${formatCount(video.viewCount)} просмотров`}
            />
            <VideoStat icon={<IconThumbUp size={16} />} value={formatCount(video.likeCount)} />
            <VideoStat
              icon={<IconMessageCircle size={16} />}
              value={formatCount(video.commentCount)}
            />
            {video.avgViewPercentage != null && (
              <VideoStat
                icon={<IconChartArcs size={16} />}
                value={`${Math.round(video.avgViewPercentage)}% досмотр`}
              />
            )}
            {video.avgViewDuration != null && (
              <VideoStat
                icon={<IconClock size={16} />}
                value={`ср. ${formatSeconds(video.avgViewDuration)}`}
              />
            )}
          </Group>

          <RetentionSection state={state} />

          <Divider label="ИИ-разбор упаковки" labelPosition="center" />
          <AnalysisPanel key={video.id} projectId={projectId} videoId={video.id} />

          <Group justify="space-between" mt="xs">
            <Button variant="subtle" leftSection={<IconPencil size={16} />} onClick={rewriteHook}>
              Обсудить в чате
            </Button>
            <Button
              component="a"
              href={`https://www.youtube.com/watch?v=${video.id}`}
              target="_blank"
              rel="noreferrer"
              variant="default"
              leftSection={<IconExternalLink size={16} />}
            >
              На YouTube
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// ── ИИ-разбор упаковки видео (тратит 1 запрос) ────────────────────────────────

type AnalyzeState =
  | { s: "idle" }
  | { s: "loading" }
  | { s: "ready"; data: VideoAnalysis }
  | { s: "error"; msg: string };

function AnalysisPanel({ projectId, videoId }: { projectId: string; videoId: string }) {
  const dispatch = useAppDispatch();
  const [st, setSt] = useState<AnalyzeState>({ s: "idle" });

  const run = async () => {
    setSt({ s: "loading" });
    const res = await apiAnalyzeVideo(projectId, videoId);
    if (res.ok) {
      dispatch(bumpRequestsUsed()); // остаток квоты в шапке/биллинге не отстаёт
      setSt({ s: "ready", data: res.data });
    } else {
      setSt({ s: "error", msg: res.error });
    }
  };

  if (st.s === "idle") {
    return (
      <Box>
        <Button
          fullWidth
          color="brand"
          leftSection={<IconSparkles size={18} />}
          onClick={run}
        >
          Разобрать видео с ИИ
        </Button>
        <Text size="xs" c="dimmed" ta="center" mt={6}>
          Разберу название, описание и удержание по методике и предложу улучшения. Тратит 1 запрос.
        </Text>
      </Box>
    );
  }

  if (st.s === "loading") {
    return (
      <Stack gap="xs" align="center" py="lg">
        <Loader color="brand" />
        <Text size="sm" c="dimmed" ta="center">
          Разбираю видео по методике… это может занять до минуты.
        </Text>
      </Stack>
    );
  }

  if (st.s === "error") {
    return (
      <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
        <Stack gap="xs" align="flex-start">
          <Text size="sm">{st.msg}</Text>
          <Button size="xs" variant="light" color="red" onClick={run}>
            Попробовать снова
          </Button>
        </Stack>
      </Alert>
    );
  }

  const a = st.data;
  return (
    <Stack gap="md">
      {(a.summary.good.length > 0 || a.summary.bad.length > 0) && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <SummaryList
            title="Сильные стороны"
            items={a.summary.good}
            color="teal"
            icon={<IconCircleCheck size={14} />}
          />
          <SummaryList
            title="Что улучшить"
            items={a.summary.bad}
            color="orange"
            icon={<IconAlertTriangle size={14} />}
          />
        </SimpleGrid>
      )}

      {a.titles.length > 0 && (
        <Box>
          <Text fw={600} mb="xs">
            Варианты названия (ВИСП)
          </Text>
          <Stack gap="xs">
            {a.titles.map((t, i) => (
              <CopyRow key={i} text={t} />
            ))}
          </Stack>
        </Box>
      )}

      {a.description && (
        <Box>
          <Text fw={600} mb="xs">
            Описание
          </Text>
          <CopyRow text={a.description} multiline />
        </Box>
      )}

      {a.tags.length > 0 && (
        <Box>
          <Group justify="space-between" mb="xs" wrap="nowrap">
            <Text fw={600}>Теги</Text>
            <CopyButton value={a.tags.join(", ")} timeout={1500}>
              {({ copied, copy }) => (
                <Button
                  size="xs"
                  variant="subtle"
                  color={copied ? "teal" : "gray"}
                  leftSection={
                    copied ? <IconCircleCheck size={14} /> : <IconCopy size={14} />
                  }
                  onClick={copy}
                >
                  {copied ? "Скопировано" : "Копировать все"}
                </Button>
              )}
            </CopyButton>
          </Group>
          <Group gap={6}>
            {a.tags.map((t, i) => (
              <Badge key={i} variant="light" color="gray" radius="sm">
                {t}
              </Badge>
            ))}
          </Group>
        </Box>
      )}

      <Button
        variant="light"
        color="brand"
        size="xs"
        leftSection={<IconSparkles size={14} />}
        onClick={run}
        style={{ alignSelf: "flex-start" }}
      >
        Ещё вариант разбора (−1 запрос)
      </Button>
    </Stack>
  );
}

function SummaryList({
  title,
  items,
  color,
  icon,
}: {
  title: string;
  items: string[];
  color: string;
  icon: React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <Paper withBorder radius="md" p="sm">
      <Text fw={600} size="sm" mb="xs" c={color}>
        {title}
      </Text>
      <Stack gap={8}>
        {items.map((t, i) => (
          <Group key={i} gap={8} wrap="nowrap" align="flex-start">
            <ThemeIcon
              color={color}
              variant="light"
              size={20}
              radius="xl"
              style={{ flexShrink: 0, marginTop: 1 }}
            >
              {icon}
            </ThemeIcon>
            <Text size="sm">{t}</Text>
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}

function CopyRow({ text, multiline }: { text: string; multiline?: boolean }) {
  return (
    <Paper withBorder radius="md" p="xs">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <Text
          size="sm"
          style={{ whiteSpace: multiline ? "pre-wrap" : "normal", flex: 1, minWidth: 0 }}
        >
          {text}
        </Text>
        <CopyButton value={text} timeout={1500}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? "Скопировано" : "Копировать"} withArrow>
              <ActionIcon
                variant="subtle"
                color={copied ? "teal" : "gray"}
                onClick={copy}
                aria-label="Копировать"
                style={{ flexShrink: 0 }}
              >
                {copied ? <IconCircleCheck size={16} /> : <IconCopy size={16} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
    </Paper>
  );
}

function RetentionSection({ state }: { state: DetailState }) {
  if (state.s === "loading") return <Skeleton height={240} radius="md" />;
  if (state.s === "error") {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        {state.msg}
      </Alert>
    );
  }
  const { curve, avgRelative } = state.detail;
  if (curve.length === 0) {
    return (
      <Alert color="gray" variant="light" icon={<IconAlertCircle size={16} />}>
        Недостаточно данных для кривой удержания — у ролика пока мало просмотров.
      </Alert>
    );
  }
  const chartData = curve.map((pt) => ({
    pos: Math.round(pt.ratio * 100),
    Удержание: Math.round(pt.watchRatio * 100),
  }));
  return (
    <Box>
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Text fw={600}>Кривая удержания</Text>
        {avgRelative != null && (
          <Badge color={avgRelative >= 0.5 ? "teal" : "red"} variant="light" radius="sm">
            {avgRelative >= 0.5 ? "Выше" : "Ниже"} среднего · лучше {Math.round(avgRelative * 100)}%
            похожих
          </Badge>
        )}
      </Group>
      <AreaChart
        h={240}
        data={chartData}
        dataKey="pos"
        series={[{ name: "Удержание", color: "brand.6" }]}
        curveType="monotone"
        withGradient
        withDots={false}
        valueFormatter={(v) => `${v}%`}
        gridAxis="xy"
        tickLine="none"
        xAxisProps={{ interval: 19, tickFormatter: (v: number) => `${v}%` }}
        yAxisProps={{ tickFormatter: (v: number) => `${v}%` }}
      />
      <Text size="xs" c="dimmed" mt="xs">
        По горизонтали — доля длины ролика, по вертикали — сколько зрителей ещё смотрит. Провал в
        начале = слабый хук.
      </Text>
    </Box>
  );
}

// ── Состояния ─────────────────────────────────────────────────────────────────

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <Paper withBorder radius="lg" p="xl">
      <Stack align="center" gap="md" maw={440} mx="auto" ta="center" py="xl">
        {children}
      </Stack>
    </Paper>
  );
}

function NotConnected({ settingsHref }: { settingsHref: string }) {
  return (
    <CenteredState>
      <ThemeIcon color="red" variant="light" radius="xl" size={64}>
        <IconBrandYoutube size={34} />
      </ThemeIcon>
      <Title order={3}>Подключите YouTube</Title>
      <Text c="dimmed">
        Свяжите свой YouTube-канал в настройках — и здесь появятся статистика,
        динамика просмотров и последние видео с их метриками.
      </Text>
      <Button
        component={Link}
        href={`${settingsHref}?tab=integrations`}
        color="brand"
        leftSection={<IconPlugConnected size={18} />}
      >
        Перейти к подключению
      </Button>
    </CenteredState>
  );
}

function Reauth({ settingsHref, onRetry }: { settingsHref: string; onRetry: () => void }) {
  return (
    <CenteredState>
      <ThemeIcon color="orange" variant="light" radius="xl" size={64}>
        <IconAlertCircle size={34} />
      </ThemeIcon>
      <Title order={3}>Нужно переподключить</Title>
      <Text c="dimmed">
        Доступ к YouTube истёк или был отозван. Переподключите канал в настройках,
        чтобы снова видеть статистику.
      </Text>
      <Group>
        <Button
          component={Link}
          href={`${settingsHref}?tab=integrations`}
          color="brand"
          leftSection={<IconPlugConnected size={18} />}
        >
          Переподключить
        </Button>
        <Button variant="default" onClick={onRetry}>
          Повторить
        </Button>
      </Group>
    </CenteredState>
  );
}

function ErrorState({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />} title="Ошибка">
      <Stack gap="sm" align="flex-start">
        <Text size="sm">{msg}</Text>
        <Button size="xs" variant="light" color="red" onClick={onRetry} leftSection={<IconRefresh size={14} />}>
          Повторить
        </Button>
      </Stack>
    </Alert>
  );
}

function DashboardSkeleton() {
  return (
    <Stack gap="lg">
      <Skeleton height={230} radius="lg" />
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={104} radius="lg" />
        ))}
      </SimpleGrid>
      <Skeleton height={288} radius="lg" />
      <SimpleGrid cols={{ base: 1, xs: 2, sm: 3, lg: 4, xl: 5 }} spacing="md">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} height={220} radius="lg" />
        ))}
      </SimpleGrid>
    </Stack>
  );
}
