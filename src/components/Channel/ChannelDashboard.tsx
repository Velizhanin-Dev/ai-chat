"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Accordion,
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Grid,
  CopyButton,
  Divider,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Center,
  Popover,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { AreaChart, BarChart, DonutChart, LineChart } from "@mantine/charts";
import { DatePicker } from "@mantine/dates";
import "dayjs/locale/ru";
import {
  IconBrandYoutube,
  IconUsers,
  IconEye,
  IconVideo,
  IconClock,
  IconUserPlus,
  IconChartArcs,
  IconHeartHandshake,
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
  IconChartRadar,
  IconTextCaption,
  IconCalendar,
} from "@tabler/icons-react";
import ChannelDiagnostics from "./ChannelDiagnostics";
import AchievementsCard from "@/components/Achievements/AchievementsCard";
import RoadmapCard from "./RoadmapCard";
import PackagingMatrix, {
  buildMatrix,
  quadrantMeta,
  type MatrixKind,
  type MatrixPoint,
} from "./PackagingMatrix";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { bumpRequestsUsed } from "@/store/authSlice";
import {
  apiYouTubeData,
  type PeriodSelection,
  apiYouTubeVideos,
  apiAnalyzeVideo,
  getVideoDetailCached,
  prefetchVideoDetail,
  writeHookPrompt,
  writeThumbTextsPrompt,
  formatCount,
  formatFull,
  formatDuration,
  durationToSeconds,
  formatDate,
  formatShortDate,
  formatWatchTime,
  formatSeconds,
  formatEr,
  growthPct,
  formatDeltaPct,
  formatDeltaPoints,
} from "@/lib/youtube-client";
import {
  PERIOD_DAYS,
  engagementRate,
  type YouTubeData,
  type YouTubeVideo,
  type PeriodComparison,
  type VideoDetail,
  type VideoAnalysis,
  type TrafficSource,
  type SubscriberDynamics as SubscriberDynamicsData,
  type SubscriberTimeline,
  type SubscriberTimelineVideo,
  type TimelineRelease,
  type Granularity,
  type AudienceData,
  type ContentSplit,
  type ContentSplitRow,
  type DailySplit,
  type DailyPoint,
} from "@/lib/youtube-types";

// Подпись периода для заголовков/капшенов.
function periodLabel(days: number): string {
  return days === 365 ? "за год" : `за ${days} дней`;
}
const PERIOD_OPTIONS = PERIOD_DAYS.map((d) => ({
  value: String(d),
  label: d === 365 ? "Год" : `${d} дн.`,
}));

// Время последнего реального обновления из YouTube (данные могут отдаваться из
// кэша — тогда это время исходного запроса). Только клиент — SSR не рендерит.
// Порог «это Shorts» по длительности. Флага «шортс» в API списка видео нет, а
// лимит Shorts у YouTube сейчас 3 минуты — ориентируемся на длительность.
const SHORTS_MAX_SECONDS = 180;

const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : timeFmt.format(d);
}

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
  // Период: пресет (число дней) или произвольный диапазон из календаря.
  // Держим одним состоянием — оно же уходит в запрос и в ключ кэша на сервере.
  const [period, setPeriod] = useState<PeriodSelection>(28);
  const customRange = typeof period === "object" ? period : null;
  // Разбор канала по параметрам продвижения — отдельная модалка (см. ChannelDiagnostics).
  const [diagOpen, setDiagOpen] = useState(false);
  const router = useRouter();
  const dashUserId = useAppSelector((st) => st.auth.user?.id ?? "");

  const load = useCallback(
    async (soft: boolean, force = false) => {
      if (soft) setRefreshing(true);
      else setPhase({ s: "loading" });
      const res = await apiYouTubeData(projectId, period, force);
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

  // «Слабый CTR» — собираем список реальных роликов (за период, иначе из ленты) и
  // уводим в чат с готовым разбором упаковки.
  const fixCtr = () => {
    if (phase.s !== "ready") return;
    // periodVideos — ВСЕ ролики с просмотрами за период (их может не быть, если
    // разрез Analytics не пришёл), иначе лента последних.
    const src = phase.data.periodVideos?.length
      ? phase.data.periodVideos
      : (phase.data.videos ?? []);
    writeThumbTextsPrompt(
      dashUserId,
      src.map((v) => ({
        title: v.title,
        views: v.viewCount,
        retention: v.avgViewPercentage ?? null,
      }))
    );
    router.push(`/${projectId}/chat`);
  };

  return (
    <Box style={{ flex: 1, minHeight: 0, overflowY: "auto" }} py="md">
      <Box px={{ base: "xs", sm: "md" }}>
        <Group justify="space-between" mb="md" wrap="nowrap" gap="sm">
          <Title order={2} fz={{ base: "1.35rem", sm: "1.75rem" }}>
            Канал
          </Title>
          {phase.s === "ready" && (
            <Group gap="sm" wrap="nowrap">
              {phase.data.fetchedAt && (
                <Text size="xs" c="dimmed" visibleFrom="md" style={{ whiteSpace: "nowrap" }}>
                  обновлено {formatTime(phase.data.fetchedAt)}
                </Text>
              )}
              <Button
                color="brand"
                size="sm"
                radius="md"
                leftSection={<IconChartRadar size={16} />}
                onClick={() => setDiagOpen(true)}
                visibleFrom="sm"
              >
                Разобрать канал
              </Button>
              {/* Слабый CTR — уводим в чат с РАЗБОРОМ реальных роликов канала, а не
                  с абстрактной просьбой «дай названия по ВИСП»: ассистент видит
                  текущую упаковку с цифрами и переписывает именно её. */}
              <Button
                variant="light"
                color="brand"
                size="sm"
                radius="md"
                leftSection={<IconTextCaption size={16} />}
                onClick={fixCtr}
                visibleFrom="md"
              >
                Слабый CTR — переписать превью
              </Button>
              <Tooltip label="Разобрать канал по параметрам продвижения" withArrow>
                <ActionIcon
                  variant="filled"
                  color="brand"
                  size="lg"
                  radius="md"
                  onClick={() => setDiagOpen(true)}
                  hiddenFrom="sm"
                  aria-label="Разобрать канал по параметрам продвижения"
                >
                  <IconChartRadar size={18} />
                </ActionIcon>
              </Tooltip>
              <SegmentedControl
                size="sm"
                radius="md"
                color="brand"
                // При произвольном диапазоне ни один пресет не активен: value=""
                // (Mantine снимает подсветку), выбранное показывает кнопка рядом.
                value={customRange ? "" : String(period)}
                onChange={(v) => setPeriod(Number(v))}
                data={PERIOD_OPTIONS}
                disabled={refreshing}
                aria-label="Период аналитики"
              />
              <CustomPeriodPicker
                value={customRange}
                disabled={refreshing}
                onApply={(r) => setPeriod(r)}
                onReset={() => setPeriod(28)}
              />
              <Tooltip label="Обновить данные из YouTube" withArrow>
                <ActionIcon
                  variant="light"
                  color="brand"
                  size="lg"
                  radius="md"
                  onClick={() => load(true, true)}
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

      {projectId && (
        <ChannelDiagnostics
          projectId={projectId}
          opened={diagOpen}
          onClose={() => setDiagOpen(false)}
        />
      )}
    </Box>
  );
}

// ── Загруженный дашборд ───────────────────────────────────────────────────────

function Dashboard({
  data,
}: {
  data: YouTubeData;
}) {
  const params = useParams();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  const ch = data.channel;
  const daily = data.daily ?? null;
  const period = data.period ?? null;

  // Список видео — состояние: первая страница из payload, дальше догружаем все
  // остальные постранично (курсор videosNextPageToken). Сброс при новой загрузке
  // (смена периода/обновление) — сиквенс подгрузки начинается заново.
  const [videos, setVideos] = useState<YouTubeVideo[]>(data.videos ?? []);
  const [nextToken, setNextToken] = useState<string | null>(data.videosNextPageToken ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    setVideos(data.videos ?? []);
    setNextToken(data.videosNextPageToken ?? null);
  }, [data]);

  const loadMore = useCallback(async () => {
    if (!nextToken || loadingMore) return;
    setLoadingMore(true);
    const res = await apiYouTubeVideos(projectId, nextToken);
    setLoadingMore(false);
    if (res.ok) {
      setVideos((prev) => [...prev, ...res.data.videos]);
      setNextToken(res.data.nextPageToken);
    } else {
      // Ошибка/переподключение — прекращаем автоподгрузку, чтобы не долбить.
      setNextToken(null);
    }
  }, [nextToken, loadingMore, projectId]);

  // Автоподгрузка при доскролле до конца ленты (сентинел). Видео — в самом низу
  // длинного дашборда, поэтому на открытии не триггерится: только когда доскроллил.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !nextToken) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "300px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [nextToken, loadMore]);

  // Фильтр ленты роликов. Тип определяем по длительности: YouTube не отдаёт
  // признак «это Shorts» в списке видео, а лимит Shorts сейчас 3 минуты. Ролики
  // без длительности (не загрузилась) считаем длинными, чтобы не прятать их.
  const [videoKind, setVideoKind] = useState<"all" | "shorts" | "long">("all");
  const shownVideos = useMemo(() => {
    if (videoKind === "all") return videos;
    return videos.filter((v) => {
      const sec = durationToSeconds(v.duration);
      const isShort = sec > 0 && sec <= SHORTS_MAX_SECONDS;
      return videoKind === "shorts" ? isShort : !isShort;
    });
  }, [videos, videoKind]);

  // Выбранное видео для детальной панели (кривая удержания).
  const [selected, setSelected] = useState<YouTubeVideo | null>(null);

  // Быстрый доступ к видео по id — чтобы клик по драйверу в лидерборде открывал
  // модалку с полными метриками, если ролик уже подгружен в ленте.
  const videosById = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos]);
  const openDriver = useCallback(
    (v: SubscriberTimelineVideo) => {
      const existing = videosById.get(v.id);
      setSelected(
        existing ?? {
          id: v.id,
          title: v.title,
          thumbnail: v.thumbnail,
          publishedAt: v.publishedAt ?? "",
          duration: "",
          viewCount: 0,
          likeCount: 0,
          commentCount: 0,
        }
      );
    },
    [videosById]
  );

  // Матрица «упаковка ↔ содержание» и очередь «что чинить» — из уже загруженных
  // роликов (нужны удержание и просмотры) + подписки по роликам из payload.
  // Считаем ОТДЕЛЬНО для лонгов и шортсов: медианы внутри своего типа, иначе
  // шортсы (другие охваты и досмотры) утягивают границы и все лонги валятся в
  // «провал». Переключатель выбирает, какую матрицу показывать.
  const [matrixKind, setMatrixKind] = useState<MatrixKind | null>(null);
  // Источник — periodVideos (ВСЕ ролики с просмотрами за выбранный период, до
  // 200, приходят одним разрезом Analytics), а НЕ лента `videos`: та грузится
  // постранично по скроллу, и матрица зависела бы от того, сколько пользователь
  // докрутил. Фолбэк на ленту — если Analytics не отдал разрез по видео.
  const matrixSource = data.periodVideos?.length ? data.periodVideos : videos;
  const matrixLong = useMemo(
    () => buildMatrix(matrixSource, data.subsByVideo, "long"),
    [matrixSource, data.subsByVideo]
  );
  const matrixShorts = useMemo(
    () => buildMatrix(matrixSource, data.subsByVideo, "shorts"),
    [matrixSource, data.subsByVideo]
  );
  const hasLong = matrixLong.points.length >= 3;
  const hasShorts = matrixShorts.points.length >= 3;
  // Переключатель доступен ВСЕГДА (иначе непонятно, что раздел умеет оба типа),
  // но стартуем с того, где данные есть: на канале из одних шортсов открывать
  // пустую матрицу лонгов бессмысленно. null = пользователь ещё не выбирал.
  const effectiveKind: MatrixKind = matrixKind ?? (hasLong ? "long" : "shorts");
  const matrix = effectiveKind === "shorts" ? matrixShorts : matrixLong;
  // У выбранного типа мало роликов для матрицы (нужно ≥3 точки) — рисуем
  // заглушку вместо графика, а не прячем секцию.
  const matrixEmpty = matrix.points.length < 3;
  // Порядок очереди: сперва то, где теряем больше всего — «кликнули и ушли» на
  // хорошем охвате, потом непроданный хороший контент, потом провалы.
  const fixQueue = useMemo(() => {
    const rank: Record<string, number> = { bait: 0, packaging: 1, fail: 2, works: 3 };
    return matrix.points
      .filter((p) => p.quadrant !== "works")
      .sort((a, b) => rank[a.quadrant] - rank[b.quadrant] || b.video.viewCount - a.video.viewCount)
      .slice(0, 6);
  }, [matrix.points]);

  if (!ch) return null;

  return (
    <Stack gap="lg">
      {/* Строка 1: канал (+ показатели за период внутри блока) + достижения */}
      <Grid columns={8} gutter="md">
        <Grid.Col span={{ base: 8, md: 3 }}>
          <ChannelCard ch={ch} period={period} />
        </Grid.Col>
        <Grid.Col span={{ base: 8, md: 5 }}>
          <AchievementsCard />
        </Grid.Col>
      </Grid>

      {/* Дорожная карта «что чинить по шагам» (docs/channel-roadmap.md). */}
      {projectId && <RoadmapCard projectId={projectId} />}

      {/* Метрики канала за всё время — только когда периода нет (у периода KPI
          теперь живут ВНУТРИ карточки канала, см. ChannelCard). */}
      {!period && (
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

      {/* Строка 3: диагностика — матрица + очередь «что чинить» */}
      {(hasLong || hasShorts) && (
        <Grid columns={8} gutter="md">
          <Grid.Col span={{ base: 8, lg: 5 }}>
            <Box className="an-surface" p="md">
              <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                <Box style={{ minWidth: 0 }}>
                  <Text fw={600}>Что чинить</Text>
                  <Text size="xs" c="dimmed" mb="sm">
                    Точка — ролик. Правее — больше просмотров, выше — дольше смотрят. Нажми на
                    точку, чтобы открыть разбор.
                  </Text>
                </Box>
                {/* Переключатель типа контента — НЕ мелкий: матрица считает медианы
                    ВНУТРИ типа, и от него зависит вся картина «что чинить». Раньше
                    стоял size="xs" и терялся в шапке — люди не замечали, что раздел
                    умеет и лонги, и шортсы. */}
                <SegmentedControl
                  size="md"
                  radius="md"
                  color="brand"
                  value={effectiveKind}
                  onChange={(v) => setMatrixKind(v as MatrixKind)}
                  data={[
                    { label: "Видео", value: "long" },
                    { label: "Shorts", value: "shorts" },
                  ]}
                  style={{ flexShrink: 0, fontWeight: 600 }}
                  aria-label="Тип контента для матрицы"
                />
              </Group>
              {matrixEmpty ? (
                <Center h={260}>
                  <Text size="sm" c="dimmed" ta="center" maw={280}>
                    {effectiveKind === "shorts"
                      ? "Шортсов с аналитикой пока мало — нужно хотя бы три ролика."
                      : "Обычных видео с аналитикой пока мало — нужно хотя бы три ролика."}
                  </Text>
                </Center>
              ) : (
                <PackagingMatrix
                  points={matrix.points}
                  medianRetention={matrix.medianRetention}
                  onOpenVideo={setSelected}
                  kind={effectiveKind}
                />
              )}
            </Box>
          </Grid.Col>
          <Grid.Col span={{ base: 8, lg: 3 }}>
            <FixQueue items={fixQueue} onOpen={setSelected} kind={effectiveKind} />
          </Grid.Col>
        </Grid>
      )}

      {/* Строка 4: динамика ОТДЕЛЬНО по лонгам и шортсам. В общем графике эти
          две природы охвата смешиваются: всплеск шортса читается как «канал
          вырос», хотя лонги в это время могли просесть. */}
      <ContentTypeCharts split={data.dailySplit ?? null} totals={data.contentSplit ?? null} />

      {/* Подробности: то, что нужно не каждый раз — под сворачиванием */}
      <Accordion variant="separated" radius="lg" multiple classNames={{ item: "an-acc-item" }}>
        {(data.subscribers?.timeline || (daily && daily.length > 0)) && (
          <Accordion.Item value="growth">
            <Accordion.Control icon={<IconChartArcs size={18} />}>Рост канала</Accordion.Control>
            <Accordion.Panel>
              {data.subscribers?.timeline && data.subscribers.timeline.buckets.length > 0 ? (
                <GrowthSection
                  sub={data.subscribers}
                  days={period?.days ?? 28}
                  subscribersNow={ch.subscriberCount}
                  hiddenSubscribers={ch.hiddenSubscriberCount}
                  onOpenVideo={openDriver}
                />
              ) : (
                daily && (
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
                )
              )}
            </Accordion.Panel>
          </Accordion.Item>
        )}
        {data.traffic && data.traffic.length > 0 && (
          <Accordion.Item value="traffic">
            <Accordion.Control icon={<IconChartArcs size={18} />}>
              Источники трафика
            </Accordion.Control>
            <Accordion.Panel>
              <TrafficSources traffic={data.traffic} days={period?.days ?? 28} />
            </Accordion.Panel>
          </Accordion.Item>
        )}
        {data.audience && (
          <Accordion.Item value="audience">
            <Accordion.Control icon={<IconUsers size={18} />}>Аудитория</Accordion.Control>
            <Accordion.Panel>
              <AudienceSection a={data.audience} days={period?.days ?? 28} />
            </Accordion.Panel>
          </Accordion.Item>
        )}
      </Accordion>

      {/* Видео канала — все ролики, догружаются постранично при доскролле */}
      <Box>
        <Group justify="space-between" mb="md" wrap="wrap" gap="sm">
          <Group gap="sm" wrap="nowrap">
            <Text fw={600}>Видео канала</Text>
            {videos.length > 0 && (
              <Text size="sm" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
                {videoKind === "all"
                  ? `${formatCount(videos.length)}${
                      ch.videoCount > videos.length ? ` из ${formatCount(ch.videoCount)}` : ""
                    }`
                  : `${formatCount(shownVideos.length)} из ${formatCount(videos.length)}`}
              </Text>
            )}
          </Group>
          {videos.length > 0 && (
            <SegmentedControl
              size="xs"
              radius="md"
              value={videoKind}
              onChange={(v) => setVideoKind(v as "all" | "shorts" | "long")}
              data={[
                { label: "Все", value: "all" },
                { label: "Shorts", value: "shorts" },
                { label: "Видео", value: "long" },
              ]}
            />
          )}
        </Group>
        {videos.length === 0 ? (
          <Text size="sm" c="dimmed">
            На канале пока нет опубликованных видео.
          </Text>
        ) : shownVideos.length === 0 ? (
          <Text size="sm" c="dimmed">
            {videoKind === "shorts"
              ? "Среди загруженных роликов нет Shorts — пролистай ниже, чтобы подгрузить остальные."
              : "Среди загруженных роликов нет длинных видео — пролистай ниже, чтобы подгрузить остальные."}
          </Text>
        ) : (
          <SimpleGrid cols={{ base: 1, xs: 2, sm: 3, lg: 4, xl: 5 }} spacing="md">
            {shownVideos.map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                onOpen={setSelected}
                onPrefetch={() => prefetchVideoDetail(projectId, v.id, v.publishedAt)}
              />
            ))}
          </SimpleGrid>
        )}
        {/* Сентинел автоподгрузки + кнопка-фолбэк «Показать ещё» */}
        {nextToken && (
          <Group ref={sentinelRef} justify="center" mt="lg">
            <Button
              variant="light"
              color="brand"
              radius="md"
              onClick={loadMore}
              loading={loadingMore}
            >
              Показать ещё
            </Button>
          </Group>
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

// Карточка канала — первая колонка первой строки. Компактная: тонкий баннер,
// аватар, счётчики и описание в две строки.
function ChannelCard({
  ch,
  period,
}: {
  ch: NonNullable<YouTubeData["channel"]>;
  period: PeriodComparison | null;
}) {
  return (
    <Box className="an-surface" style={{ overflow: "hidden", height: "100%" }}>
      <Box
        style={{
          height: 72,
          background: ch.banner
            ? `center / cover no-repeat url("${ch.banner}=w1280")`
            : "linear-gradient(120deg, var(--mantine-color-brand-6), var(--mantine-color-brand-8))",
        }}
      />
      <Box px="md" pb="md" style={{ marginTop: -28 }}>
        <Avatar
          src={ch.thumbnail}
          size={64}
          radius="50%"
          color="red"
          style={{ border: "4px solid var(--mantine-color-body)" }}
        >
          <IconBrandYoutube size={32} />
        </Avatar>
        <Title order={3} fz="1.15rem" mt="xs" lineClamp={1}>
          {ch.title}
        </Title>
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
        <Group gap="lg" mt="sm" wrap="wrap">
          <Box>
            <Text fz="1.15rem" fw={700} lh={1.2}>
              {ch.hiddenSubscriberCount ? "—" : formatCount(ch.subscriberCount)}
            </Text>
            <Text size="xs" c="dimmed">
              подписчиков
            </Text>
          </Box>
          <Box>
            <Text fz="1.15rem" fw={700} lh={1.2}>
              {formatCount(ch.viewCount)}
            </Text>
            <Text size="xs" c="dimmed">
              просмотров
            </Text>
          </Box>
          <Box>
            <Text fz="1.15rem" fw={700} lh={1.2}>
              {formatCount(ch.videoCount)}
            </Text>
            <Text size="xs" c="dimmed">
              видео
            </Text>
          </Box>
        </Group>
        {ch.description && (
          <Text size="xs" c="dimmed" mt="sm" lineClamp={2}>
            {ch.description}
          </Text>
        )}

        {/* Показатели за выбранный период — внутри блока канала (перенесены из
            отдельной строки KPI под дашбордом). */}
        {period && (
          <>
            <Divider my="md" />
            <Text
              size="xs"
              c="dimmed"
              fw={700}
              tt="uppercase"
              mb="sm"
              style={{ letterSpacing: "0.04em" }}
            >
              Показатели {periodLabel(period.days)}
            </Text>
            <ChannelPeriodKpis period={period} />
          </>
        )}
      </Box>
    </Box>
  );
}

// KPI периода ВНУТРИ карточки канала — вертикальный список стат-строк (заполняет
// высоту узкой колонки лучше, чем 2×2, и не оставляет пустоты снизу). Стиль строки
// (.kpi-row) единый со стат-чипами достижений в соседней карточке.
function ChannelPeriodKpis({ period }: { period: PeriodComparison }) {
  const { current: c, previous: p } = period;
  const dPoints = p ? c.avgViewPercentage - p.avgViewPercentage : null;
  return (
    <Stack gap="sm">
      <KpiRow
        icon={<IconEye size={17} />}
        color="brand"
        label="Просмотры"
        value={formatCount(c.views)}
        pct={growthPct(c.views, p?.views)}
      />
      <KpiRow
        icon={<IconClock size={17} />}
        color="blue"
        label="Время просмотра"
        value={formatWatchTime(c.minutes)}
        pct={growthPct(c.minutes, p?.minutes)}
      />
      <KpiRow
        icon={<IconUserPlus size={17} />}
        color="teal"
        label="Подписчики"
        value={`${c.netSubscribers >= 0 ? "+" : "−"}${formatCount(Math.abs(c.netSubscribers))}`}
        pct={growthPct(c.netSubscribers, p?.netSubscribers)}
      />
      <KpiRow
        icon={<IconChartArcs size={17} />}
        color="grape"
        label="Ср. % досмотра"
        value={`${Math.round(c.avgViewPercentage)}%`}
        deltaText={dPoints != null ? formatDeltaPoints(dPoints) : undefined}
        deltaUp={dPoints != null ? dPoints >= 0 : undefined}
        deltaNeutral={dPoints != null ? Math.round(dPoints * 10) === 0 : undefined}
      />
    </Stack>
  );
}

// Одна стат-строка: иконка-чип, подпись+значение, дельта-пилюля справа.
function KpiRow({
  icon,
  color,
  label,
  value,
  pct,
  deltaText,
  deltaUp,
  deltaNeutral,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: string;
  pct?: number | null;
  deltaText?: string;
  deltaUp?: boolean;
  deltaNeutral?: boolean;
}) {
  return (
    <Box className="kpi-row">
      <ThemeIcon size={34} radius="md" variant="light" color={color}>
        {icon}
      </ThemeIcon>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="xs" c="dimmed" truncate>
          {label}
        </Text>
        <Text fz="1.35rem" fw={800} lh={1.1} style={{ fontVariantNumeric: "tabular-nums" }}>
          {value}
        </Text>
      </Box>
      <DeltaPill pct={pct} text={deltaText} up={deltaUp} neutral={deltaNeutral} />
    </Box>
  );
}

// Пилюля дельты: цветной тинт (teal рост / red падение / gray нейтраль) + стрелка.
// Нет прошлого периода → тихий прочерк, без пилюли.
function DeltaPill({
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
  let label = text;
  let isUp = up ?? false;
  let isNeutral = neutral ?? false;
  if (label === undefined) {
    if (pct == null) {
      return (
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          —
        </Text>
      );
    }
    const rounded = Math.round(pct);
    label = formatDeltaPct(pct);
    isUp = rounded > 0;
    isNeutral = rounded === 0;
  }
  const col = isNeutral ? "gray" : isUp ? "teal" : "red";
  const Icon = isUp ? IconArrowUpRight : IconArrowDownRight;
  return (
    <Box
      className="kpi-delta"
      style={{
        flexShrink: 0,
        background: `var(--mantine-color-${col}-light)`,
        color: `var(--mantine-color-${col}-light-color)`,
      }}
    >
      {!isNeutral && <Icon size={13} stroke={2.5} />}
      {label}
    </Box>
  );
}

// Очередь «что чинить»: ролики из проблемных углов матрицы. `kind` — тот же тип
// контента, что выбран в матрице: подписи диагнозов у лонгов и шортсов разные.
function FixQueue({
  items,
  onOpen,
  kind,
}: {
  items: MatrixPoint[];
  onOpen: (v: YouTubeVideo) => void;
  kind: MatrixKind;
}) {
  const META = quadrantMeta(kind);
  return (
    <Stack gap="md" style={{ height: "100%" }}>
      <Box className="an-surface" p="md">
        <Text fw={600} mb={4}>
          Очередь на переделку
        </Text>
        {items.length === 0 ? (
          <Text size="sm" c="dimmed">
            Проблемных роликов не вижу — по охвату и досмотру всё в норме канала.
          </Text>
        ) : (
          <Stack gap={2}>
            {items.map((p) => {
              const meta = META[p.quadrant];
              return (
                <UnstyledButton
                  key={p.video.id}
                  className="yt-driver-row"
                  onClick={() => onOpen(p.video)}
                >
                  <Group gap={8} wrap="nowrap" align="flex-start">
                    <Box
                      w={8}
                      h={8}
                      mt={6}
                      style={{
                        borderRadius: 2,
                        flexShrink: 0,
                        background: `var(--mantine-color-${meta.color}-6)`,
                      }}
                    />
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Text size="sm" lineClamp={1}>
                        {p.video.title}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {meta.label} · {formatCount(p.video.viewCount)} просмотров ·{" "}
                        {Math.round(p.retention)}% досмотр
                      </Text>
                    </Box>
                  </Group>
                </UnstyledButton>
              );
            })}
          </Stack>
        )}
      </Box>

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
      <Paper className="an-surface" radius="lg" p="md">
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
    <Paper radius="lg" p={0} bg="transparent">
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

// ── Рост канала: просмотры + прирост подписчиков по видео-драйверам + релизы ────

// Палитра серий стека (видео-драйверы), по порядку убывания вклада. Цвета
// различимы и держат контраст в обеих темах; «Другое» — нейтральный серый.
const VIDEO_COLORS = ["brand.6", "blue.6", "teal.6", "grape.6", "cyan.6", "yellow.6"];
const OTHER_COLOR = "gray.5";
const OTHER_KEY = "__other__";
const cssVar = (c: string) => `var(--mantine-color-${c.replace(".", "-")})`;

const bucketMonthFmt = new Intl.DateTimeFormat("ru-RU", { month: "short", year: "2-digit" });
// Подпись отрезка на оси: месяц («июл 26») или короткая дата дня/недели («3 июл»).
function bucketLabel(key: string, gran: Granularity): string {
  if (gran === "month") {
    const [y, m] = key.split("-").map(Number);
    return bucketMonthFmt.format(new Date(Date.UTC(y, (m || 1) - 1, 1)));
  }
  return formatShortDate(key);
}

// ── Произвольный период («Выбрать период») ─────────────────────────────────
// Рядом с пресетами 7/28/90/365 — свой диапазон дат. Календарь — НАТИВНЫЙ
// (input type="date"): в проекте уже так сделано в админке, и это избавляет от
// зависимостей @mantine/dates + dayjs ради одного пикера. Кнопка «Применить»
// активна только при корректном диапазоне; выбранное показывается на кнопке.
function CustomPeriodPicker({
  value,
  disabled,
  onApply,
  onReset,
}: {
  value: { start: string; end: string } | null;
  disabled: boolean;
  onApply: (range: { start: string; end: string }) => void;
  onReset: () => void;
}) {
  const [opened, setOpened] = useState(false);
  // С Mantine 8 DatePicker отдаёт СТРОКИ "YYYY-MM-DD" (в 7.x были Date) — это
  // ровно то, что ждут Analytics API и ключ кэша, конвертация не нужна. Заодно
  // ушла ловушка с toISOString: он переводит в UTC и в плюсовых часовых поясах
  // сдвигал выбранный день на сутки назад.
  const [range, setRange] = useState<[string | null, string | null]>([
    value?.start ?? null,
    value?.end ?? null,
  ]);
  const [from, to] = range;
  const valid = Boolean(from && to);

  const apply = () => {
    if (!from || !to) return;
    onApply({ start: from, end: to });
    setOpened(false);
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      withArrow
      shadow="md"
      radius="md"
      trapFocus
    >
      <Popover.Target>
        <Button
          size="sm"
          radius="md"
          variant={value ? "filled" : "default"}
          color="brand"
          leftSection={<IconCalendar size={16} />}
          onClick={() => setOpened((o) => !o)}
          disabled={disabled}
        >
          {value ? `${formatShortDate(value.start)} — ${formatShortDate(value.end)}` : "Выбрать период"}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <DatePicker
            type="range"
            value={range}
            onChange={setRange}
            maxDate={new Date().toISOString().slice(0, 10)}
            locale="ru"
            size="sm"
            allowSingleDateInRange
          />
          <Group gap="xs" grow>
            {value && (
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => {
                  setRange([null, null]);
                  onReset();
                  setOpened(false);
                }}
              >
                Сбросить
              </Button>
            )}
            <Button size="xs" color="brand" onClick={apply} disabled={!valid}>
              Применить
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

// ── Динамика отдельно по лонгам и шортсам ──────────────────────────────────
// Два независимых графика вместо одного общего: у шортсов и лонгов разная
// природа охвата, и в общем ряду они смешиваются — всплеск одного шортса читается
// как «канал вырос», хотя лонги в это же время могли просесть. Оси времени у
// обоих графиков одинаковые (сервер добивает пропущенные дни нулями), поэтому
// карточки можно сравнивать взглядом.
function ContentTypeChart({
  title,
  hint,
  points,
  totals,
  color,
}: {
  title: string;
  hint: string;
  points: DailyPoint[];
  totals: ContentSplitRow | null;
  color: string;
}) {
  const views = points.reduce((s, p) => s + p.views, 0);
  const gained = points.reduce((s, p) => s + p.subscribersGained, 0);
  // Карточку показываем ВСЕГДА — и когда контента такого типа за период не было.
  // Пустое место молча съедало бы вопрос «а где шортсы?»: непонятно, то ли их
  // нет, то ли раздел сломался.
  const empty = points.length === 0 || views === 0;

  return (
    // h=100% + flex-колонка: соседняя карточка может быть пустой («данных нет»),
    // и без растяжки соседи разной высоты — на десктопе это видно сразу.
    // Grid.Col тянет колонки по высоте строки, карточка занимает её целиком.
    <Box
      className="an-surface"
      p="md"
      h="100%"
      style={{ display: "flex", flexDirection: "column" }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb={2}>
        <div style={{ minWidth: 0 }}>
          <Text fw={600}>{title}</Text>
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        </div>
      </Group>

      {empty ? (
        <Center style={{ flex: 1, minHeight: 248 }}>
          <Stack align="center" gap={4}>
            <IconChartArcs size={26} style={{ color: "var(--mantine-color-dimmed)" }} />
            <Text size="sm" c="dimmed" ta="center">
              Данных за выбранный период нет
            </Text>
          </Stack>
        </Center>
      ) : (
        <>
          <Group gap="lg" mb="sm" mt="xs">
            <div>
              <Text size="xs" c="dimmed">
                Просмотры
              </Text>
              <Text fw={700}>{formatFull(views)}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Подписчиков
              </Text>
              <Text fw={700}>
                {gained > 0 ? `+${formatFull(gained)}` : formatFull(gained)}
              </Text>
            </div>
            {/* Средний досмотр отдаёт только сводный разрез (contentSplit) — по
                дням его взвешенно не пересчитать, берём готовый за период. */}
            {totals && (
              <div>
                <Text size="xs" c="dimmed">
                  Ср. досмотр
                </Text>
                <Text fw={700}>{Math.round(totals.avgViewPercentage)}%</Text>
              </div>
            )}
          </Group>
          <AreaChart
            h={200}
            data={points.map((d) => ({
              date: formatShortDate(d.date),
              Просмотры: d.views,
            }))}
            dataKey="date"
            series={[{ name: "Просмотры", color }]}
            curveType="monotone"
            withGradient
            withDots={false}
            valueFormatter={(v) => formatFull(v)}
            gridAxis="y"
            tickLine="none"
          />
        </>
      )}
    </Box>
  );
}

function ContentTypeCharts({
  split,
  totals,
}: {
  split: DailySplit | null;
  totals: ContentSplit | null;
}) {
  // Совсем нет разбивки (API не отдал тип контента) — секции нет, общий график
  // динамики остаётся в «подробностях». А вот если один из типов пуст —
  // карточку всё равно рисуем с «данных нет»: иначе непонятно, то ли контента
  // такого не было, то ли раздел не догрузился.
  if (!split || (!split.long && !split.shorts)) return null;

  return (
    <Grid columns={8} gutter="md">
      <Grid.Col span={{ base: 8, lg: 4 }}>
        <ContentTypeChart
          title="Обычные видео"
          hint="Просмотры лонгов по дням"
          points={split.long ?? []}
          totals={totals?.long ?? null}
          color="brand.6"
        />
      </Grid.Col>
      <Grid.Col span={{ base: 8, lg: 4 }}>
        <ContentTypeChart
          title="Шортсы"
          hint="Просмотры шортсов по дням"
          points={split.shorts ?? []}
          totals={totals?.shorts ?? null}
          color="teal.6"
        />
      </Grid.Col>
    </Grid>
  );
}

function GrowthSection({
  sub,
  days,
  subscribersNow,
  hiddenSubscribers,
  onOpenVideo,
}: {
  sub: SubscriberDynamicsData;
  days: number;
  // Текущее число подписчиков — точка отсчёта для кривой «всего подписчиков»
  // (историю общего счётчика YouTube не отдаёт, восстанавливаем её назад по приросту).
  subscribersNow: number;
  hiddenSubscribers: boolean;
  onOpenVideo: (v: SubscriberTimelineVideo) => void;
}) {
  const tl = sub.timeline as SubscriberTimeline;
  const gran = tl.granularity;
  const drivers = tl.videos;
  // Мемо, потому что обе карты уходят в зависимости showTip (useCallback) — без
  // этого он пересобирался бы на каждый рендер.
  const colorById = useMemo(
    () => new Map(drivers.map((v, i) => [v.id, VIDEO_COLORS[i % VIDEO_COLORS.length]])),
    [drivers]
  );

  const hasOther = tl.buckets.some((b) => b.other > 0);
  const hasSubs = tl.buckets.some((b) => b.totalGained > 0);
  const hasViews = tl.buckets.some((b) => b.views > 0);
  const hasReleases = tl.buckets.some((b) => b.releases.length > 0);

  // ⚠️ Реконструкция кривой «всего подписчиков» отсюда УБРАНА вместе с линейным
  // графиком: она восстанавливала абсолютный счётчик назад от текущего числа, а
  // YouTube округляет subscriberCount выше 1000 — то есть цифры были оценкой.
  // Понедельный график ниже копит ПРИРОСТ за период, а его YouTube отдаёт точно.

  // Строка = отрезок времени. Каждый драйвер — своя секция столбца, плюс «Другое»
  // (прирост, который не удалось отнести к конкретному ролику).
  const rows = tl.buckets.map((b) => {
    const row: Record<string, string | number> = { label: bucketLabel(b.key, gran) };
    for (const v of drivers) row[v.title || v.id] = b.gainedByVideo[v.id] ?? 0;
    if (hasOther) row["Другое"] = b.other;
    return row;
  });

  // Серии стека в том же порядке и теми же цветами, что лидерборд под графиком.
  const barSeries = [
    ...drivers.map((v) => ({ name: v.title || v.id, color: colorById.get(v.id) as string })),
    ...(hasOther ? [{ name: "Другое", color: OTHER_COLOR }] : []),
  ];

  // Понедельный рост: буквы ТЗ — «растущий график, сколько за неделю пришло».
  // Копим сумму от начала периода, в тултипе видно и прирост недели, и итог.
  const weekly = useMemo(() => {
    const byWeek = new Map<string, number>();
    for (const b of tl.buckets) {
      const d = new Date(`${b.key.length === 7 ? `${b.key}-01` : b.key}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) continue;
      // Понедельник этой недели — канонический ключ.
      const day = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - day);
      const key = d.toISOString().slice(0, 10);
      byWeek.set(key, (byWeek.get(key) ?? 0) + b.totalGained);
    }
    let acc = 0;
    return Array.from(byWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, gained]) => {
        acc += gained;
        return { label: bucketLabel(key, "week"), Подписчики: acc, gained };
      });
  }, [tl.buckets]);

  // Ось Y столбцов всегда от нуля — иначе секции стека врут по площади.
  // (Прежний расчёт домена был нужен накопленной ЛИНИИ; она уехала в понедельный
  // график ниже, где домен считается отдельно.)
  // Отрезок по подписи — тултипу нужна раскладка прироста по видео, а линия её
  // в payload не несёт (в отличие от прежнего стека).
  const bucketByLabel = useMemo(
    () => new Map(tl.buckets.map((b) => [bucketLabel(b.key, gran), b])),
    [tl.buckets, gran]
  );

  // Главный драйвер отрезка — им красим точку на линии, чтобы цвет ролика
  // остался считываемым и без столбцов.
  const topDriverByLabel = new Map<string, string | null>(
    tl.buckets.map((b) => {
      let top: string | null = null;
      let max = 0;
      for (const v of drivers) {
        const g = b.gainedByVideo[v.id] ?? 0;
        if (g > max) {
          max = g;
          top = v.id;
        }
      }
      return [bucketLabel(b.key, gran), top];
    })
  );

  // Релизы по подписи отрезка — для рейки превью под нижним графиком.
  const releasesByLabel: Record<string, TimelineRelease[]> = {};
  for (const b of tl.buckets) {
    if (b.releases.length) releasesByLabel[bucketLabel(b.key, gran)] = b.releases;
  }

  const titleById = new Map<string, string>([
    ...drivers.map((v) => [v.id, v.title] as const),
    [OTHER_KEY, "Другое"],
  ]);

  // Итоги — из дневного ряда (там есть и «ушло», чего нет в таймлайне прироста).
  const totalGained = sub.daily.reduce((s, d) => s + d.gained, 0);
  const totalLost = sub.daily.reduce((s, d) => s + d.lost, 0);
  const net = totalGained - totalLost;
  const otherTotal = tl.buckets.reduce((s, b) => s + b.other, 0);

  // Показываем ~8 подписей дат; превью релизов — на всех своих отрезках.
  const stride = Math.max(1, Math.ceil(tl.buckets.length / 8));
  const xAxisHeight = hasReleases ? 46 : 22;

  // Мета видео для тултипа: превью + ссылка на ролик (по id серии столбца).
  const metaById = new Map<string, TipMeta>(
    drivers.map((v) => [
      v.id,
      { title: v.title, thumbnail: v.thumbnail, url: `https://www.youtube.com/watch?v=${v.id}` },
    ])
  );

  // ── Интерактивный «липкий» тултип столбца ───────────────────────────────────
  // recharts-тултип по умолчанию не наводибельный и пропадает мгновенно. Делаем
  // свой оверлей: recharts-контент работает сенсором позиции (TooltipSensor), а
  // карточку рисуем сами с таймером скрытия, который отменяется при наведении на
  // неё — так пользователь успевает перейти на тултип и кликнуть по ссылке видео.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Мышь сейчас над самой карточкой тултипа — тогда прятать нельзя (recharts при
  // уходе курсора с графика шлёт active=false и на КАЖДЫЙ ре-рендер, поэтому таймер
  // скрытия может перевзвестись уже после входа на карточку; проверяем флаг в колбэке).
  const hoveringCard = useRef(false);
  const clearHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);
  const scheduleHide = useCallback(() => {
    clearHide();
    hideTimer.current = setTimeout(() => {
      if (!hoveringCard.current) setTip(null);
    }, 500);
  }, [clearHide]);
  const showTip = useCallback(
    (x: number, y: number, label: string) => {
      clearHide();
      // Раскладку по видео берём из самого отрезка: у линии в payload лежит только
      // суммарный прирост.
      const b = bucketByLabel.get(label);
      const items = b
        ? [
            ...drivers
              .map((v) => ({
                key: v.id,
                value: b.gainedByVideo[v.id] ?? 0,
                color: cssVar(colorById.get(v.id) as string),
              }))
              .filter((i) => i.value > 0),
            ...(b.other > 0
              ? [{ key: OTHER_KEY, value: b.other, color: cssVar(OTHER_COLOR) }]
              : []),
          ].sort((a, c) => c.value - a.value)
        : [];
      // Клампим X, чтобы карточка не уезжала за края графика.
      const w = wrapRef.current?.offsetWidth ?? 600;
      const cx = Math.min(Math.max(x, 160), w - 160);
      const next: TipState = {
        x: cx,
        y,
        label,
        // Абсолютный счётчик больше не показываем (см. комментарий выше).
        total: null,
        gained: b?.totalGained ?? 0,
        lost: b?.totalLost ?? 0,
        items,
      };
      setTip((prev) => (prev && prev.label === label ? prev : next));
    },
    [bucketByLabel, clearHide, colorById, drivers]
  );
  useEffect(() => clearHide, [clearHide]);

  // Точка линии в цвете главного драйвера отрезка: цвет ролика остаётся
  // считываемым и без столбцов (кольцо цветом фона отделяет точку от линии).
  const renderDot = (props: { cx?: number; cy?: number; payload?: { label?: string } }) => {
    const { cx, cy, payload } = props;
    const label = payload?.label ?? "";
    if (cx == null || cy == null) return <g key={`dot-${label}`} />;
    const top = topDriverByLabel.get(label);
    const color = top ? cssVar(colorById.get(top) as string) : "var(--mantine-color-teal-6)";
    return (
      <circle
        key={`dot-${label}`}
        cx={cx}
        cy={cy}
        r={4}
        fill={color}
        stroke="var(--mantine-color-body)"
        strokeWidth={2}
      />
    );
  };

  return (
    <Paper radius="lg" p={0} bg="transparent">
      <Group justify="space-between" mb="md" wrap="nowrap" gap="sm">
        <Text fw={600}>Рост канала {periodLabel(days)}</Text>
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

      {/* ⚠️ График просмотров отсюда УБРАН (решение владельца): он дублировал
          YouTube Studio. Оставляем только то, чего в Studio нет — атрибуцию
          подписчиков по роликам и понедельный рост. */}

      {/* Прирост подписчиков — СТОЛБЦЫ С НАКОПЛЕНИЕМ: один столбец = отрезок
          времени, секции внутри = ролики, которые привели этих подписчиков.
          Именно этого нет в Studio: там виден общий прирост, но не видно, какой
          ролик его дал. Под осью строчкой — когда какие ролики вышли. */}
      {hasSubs ? (
        <Box ref={wrapRef} style={{ position: "relative" }} onMouseLeave={scheduleHide}>
          <Text size="xs" c="dimmed" mb={4} tt="uppercase" fw={600} lts={0.3}>
            Новые подписчики по роликам
          </Text>
          <BarChart
            h={230}
            data={rows}
            dataKey="label"
            type="stacked"
            series={barSeries}
            withLegend={false}
            gridAxis="y"
            tickLine="none"
            valueFormatter={(v: number) => formatFull(v)}
            yAxisProps={{
              width: 52,
              allowDecimals: false,
              tickFormatter: (v: number) => formatCount(v),
            }}
            xAxisProps={{
              interval: 0,
              height: xAxisHeight,
              tick: (props: TickProps) => (
                <ReleaseTick
                  {...props}
                  stride={stride}
                  releases={releasesByLabel[props.payload?.value ?? ""]}
                />
              ),
            }}
            tooltipProps={{
              isAnimationActive: false,
              content: (props: any) => (
                <TooltipSensor
                  active={props.active}
                  payload={props.payload}
                  label={props.label}
                  coordinate={props.coordinate}
                  onShow={showTip}
                  onHide={scheduleHide}
                />
              ),
            }}
          />
          {tip && (
            <GrowthTipCard
              tip={tip}
              titleById={titleById}
              metaById={metaById}
              onMouseEnter={() => {
                hoveringCard.current = true;
                clearHide();
              }}
              onMouseLeave={() => {
                hoveringCard.current = false;
                scheduleHide();
              }}
            />
          )}
        </Box>
      ) : hasViews ? null : (
        <Text size="sm" c="dimmed">
          За период подписки почти не менялись.
        </Text>
      )}

      {/* Второй график — ПОНЕДЕЛЬНЫЙ рост: накопленная кривая от начала периода.
          Смысл именно в накоплении: дневная «динамика» скачет и по ней не видно,
          растёт канал или топчется. Тут линия идёт вверх ровно настолько,
          насколько канал реально прибавил. */}
      {weekly.length > 1 && (
        <Box mt="lg">
          <Text size="xs" c="dimmed" mb={4} tt="uppercase" fw={600} lts={0.3}>
            Рост по неделям
          </Text>
          <AreaChart
            h={180}
            data={weekly}
            dataKey="label"
            series={[{ name: "Подписчики", color: "teal.6" }]}
            curveType="monotone"
            withGradient
            withDots
            gridAxis="y"
            tickLine="none"
            valueFormatter={(v: number) => formatFull(v)}
            yAxisProps={{
              width: 52,
              allowDecimals: false,
              tickFormatter: (v: number) => formatCount(v),
            }}
            tooltipProps={{
              isAnimationActive: false,
              content: ({ active, label, payload }: any) => {
                if (!active || !payload?.length) return null;
                const row = weekly.find((w) => w.label === label);
                return (
                  <Paper radius="md" p="xs" withBorder shadow="sm">
                    <Text size="xs" c="dimmed">
                      неделя с {label}
                    </Text>
                    <Text size="sm" fw={600}>
                      +{formatCount(row?.gained ?? 0)} за неделю
                    </Text>
                    <Text size="xs" c="dimmed">
                      всего с начала периода: {formatCount(row?.Подписчики ?? 0)}
                    </Text>
                  </Paper>
                );
              },
            }}
          />
        </Box>
      )}

      {/* Легенда-лидерборд: видео-драйверы (цвет = серия стека), клик → разбор. */}
      {drivers.length > 0 && (
        <Box mt="lg">
          <Text fw={600} mb="sm">
            Видео, приносящие подписчиков
          </Text>
          <Stack gap="xs">
            {drivers.map((v) => (
              <DriverRow
                key={v.id}
                v={v}
                color={colorById.get(v.id) as string}
                onOpen={() => onOpenVideo(v)}
              />
            ))}
            {hasOther && otherTotal > 0 && (
              <Group gap="sm" wrap="nowrap" px={4} py={2}>
                <Box
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: cssVar(OTHER_COLOR),
                    flexShrink: 0,
                  }}
                />
                <Text size="sm" c="dimmed" style={{ flex: 1 }}>
                  Другое (старые ролики, страница канала и т.п.)
                </Text>
                <Text size="sm" fw={600} c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
                  +{formatCount(otherTotal)}
                </Text>
              </Group>
            )}
          </Stack>
        </Box>
      )}

      <Text size="xs" c="dimmed" mt="md">
        Столбец — сколько подписчиков пришло за отрезок, секции внутри — какие ролики их привели.
        Внизу строчкой видно, когда какие ролики вышли. Наведи на столбец, чтобы увидеть раскладку;
        клик по ролику открывает разбор упаковки. Нижний график — накопленный рост по неделям.
      </Text>
    </Paper>
  );
}

// Тип аргументов кастомного тика оси X (recharts прокидывает координаты + payload).
type TickProps = {
  x?: number;
  y?: number;
  index?: number;
  payload?: { value?: string };
  stride?: number;
  releases?: TimelineRelease[];
};

// Кастомный тик оси X: подпись даты (прореженная, чтобы не наезжали) + рейка
// превью роликов, вышедших в этот отрезок (SVG-миниатюры, ровно под столбцом).
function ReleaseTick({ x = 0, y = 0, index = 0, payload, stride = 1, releases }: TickProps) {
  const rel = releases ?? [];
  const showLabel = index % stride === 0;
  const thumbs = rel.slice(0, 3);
  const tw = 26;
  const th = 15;
  const gap = 3;
  const ty = 18;
  const totalW = thumbs.length * tw + (thumbs.length - 1) * gap;
  const startX = -totalW / 2;
  return (
    <g transform={`translate(${x},${y})`}>
      {showLabel && (
        <text x={0} y={0} dy={11} textAnchor="middle" fontSize={11} fill="var(--mantine-color-dimmed)">
          {payload?.value}
        </text>
      )}
      {thumbs.map((r, i) => {
        const tx = startX + i * (tw + gap);
        const clipId = `rel-clip-${index}-${i}`;
        return (
          <g key={r.id}>
            <title>{r.title}</title>
            {/* матовая подложка — отделяет превью от сетки графика */}
            <rect
              x={tx - 1.5}
              y={ty - 1.5}
              width={tw + 3}
              height={th + 3}
              rx={5}
              fill="var(--mantine-color-body)"
            />
            {r.thumbnail && (
              <>
                <clipPath id={clipId}>
                  <rect x={tx} y={ty} width={tw} height={th} rx={3} />
                </clipPath>
                <image
                  href={r.thumbnail}
                  x={tx}
                  y={ty}
                  width={tw}
                  height={th}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#${clipId})`}
                />
              </>
            )}
            {/* обводка превью */}
            <rect
              x={tx}
              y={ty}
              width={tw}
              height={th}
              rx={3}
              fill="none"
              stroke="var(--mantine-color-gray-5)"
              strokeWidth={1}
            />
          </g>
        );
      })}
      {rel.length > thumbs.length && (
        <text x={totalW / 2 + 5} y={ty + th} textAnchor="start" fontSize={9} fill="var(--mantine-color-dimmed)">
          +{rel.length - thumbs.length}
        </text>
      )}
    </g>
  );
}

// Элемент активной серии тултипа (то, что прокидывает recharts).
type TooltipItem = { dataKey?: string | number; value?: number; color?: string };
// Мета видео для тултипа/лидерборда.
type TipMeta = { title: string; thumbnail: string | null; url: string };
// Состояние «липкого» тултипа: позиция в контейнере + разложение по сериям.
type TipState = {
  x: number;
  y: number;
  label: string;
  // Накопленное число подписчиков на конец отрезка; null — кривую строим по
  // приросту (счётчик канала скрыт), тогда шапка тултипа показывает только его.
  total: number | null;
  gained: number;
  lost: number;
  items: { key: string; value: number; color: string }[];
};

// Сенсор наведения: recharts зовёт content с active/coordinate — прокидываем это
// наверх (показать/скрыть), сам ничего не рисует. Видимую карточку рисует родитель.
function TooltipSensor({
  active,
  payload,
  label,
  coordinate,
  onShow,
  onHide,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  coordinate?: { x?: number; y?: number };
  onShow: (x: number, y: number, label: string) => void;
  onHide: () => void;
}) {
  useEffect(() => {
    if (active && payload && payload.length && coordinate?.x != null) {
      onShow(coordinate.x, coordinate.y ?? 0, String(label ?? ""));
    } else {
      onHide();
    }
  });
  return null;
}

// «Липкая» карточка тултипа: превью ролика + название (кликабельные ссылки на видео)
// + зелёный «+N» подписчиков. Наведение на карточку отменяет таймер скрытия, поэтому
// пользователь может перейти по ссылке. «Другое» — без ссылки (нет конкретного видео).
function GrowthTipCard({
  tip,
  titleById,
  metaById,
  onMouseEnter,
  onMouseLeave,
}: {
  tip: TipState;
  titleById: Map<string, string>;
  metaById: Map<string, TipMeta>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <Paper
      withBorder
      radius="md"
      p="sm"
      shadow="md"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "absolute",
        left: tip.x,
        top: tip.y,
        transform: "translate(-50%, calc(-100% - 10px))",
        width: 300,
        maxWidth: "90%",
        zIndex: 5,
        pointerEvents: "auto",
      }}
    >
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text fw={600} size="sm">
          {tip.label}
        </Text>
        {tip.total != null && (
          <Text size="sm" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatFull(tip.total)}
          </Text>
        )}
      </Group>
      <Text size="xs" c="dimmed" mb="xs">
        {tip.total != null ? "всего подписчиков · " : ""}
        <Text span c="teal" fw={700} inherit>
          +{formatFull(tip.gained)}
        </Text>
        {tip.lost > 0 && (
          <>
            {" / "}
            <Text span c="red" fw={700} inherit>
              −{formatFull(tip.lost)}
            </Text>
          </>
        )}{" "}
        за отрезок
      </Text>
      <Stack gap={8}>
        {tip.items.map((it) => {
          const meta = metaById.get(it.key);
          return (
            <Group key={it.key} gap={8} wrap="nowrap" align="center">
              {meta ? (
                <Anchor
                  href={meta.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ lineHeight: 0, flexShrink: 0 }}
                  aria-label={`Открыть видео «${meta.title}» на YouTube`}
                >
                  <Box
                    className="yt-tip-thumb"
                    style={{
                      width: 56,
                      aspectRatio: "16 / 9",
                      borderRadius: 6,
                      overflow: "hidden",
                      border: `2px solid ${it.color}`,
                      background: "var(--mantine-color-dark-4)",
                    }}
                  >
                    {meta.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={meta.thumbnail}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    )}
                  </Box>
                </Anchor>
              ) : (
                <Box
                  style={{
                    width: 56,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Box
                    style={{ width: 12, height: 12, borderRadius: 3, background: it.color }}
                  />
                </Box>
              )}
              <Box style={{ flex: 1, minWidth: 0 }}>
                {meta ? (
                  <Anchor
                    href={meta.url}
                    target="_blank"
                    rel="noreferrer"
                    c="inherit"
                    underline="hover"
                    size="xs"
                    lineClamp={2}
                  >
                    {meta.title}
                  </Anchor>
                ) : (
                  <Text size="xs" c="dimmed">
                    {titleById.get(it.key) ?? "Другое"}
                  </Text>
                )}
              </Box>
              <Text
                size="xs"
                fw={700}
                c="teal"
                style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
              >
                +{formatFull(it.value)}
              </Text>
            </Group>
          );
        })}
      </Stack>
    </Paper>
  );
}

// Строка лидерборда драйвера: цвет серии + превью + название + вклад; клик → разбор.
function DriverRow({
  v,
  color,
  onOpen,
}: {
  v: SubscriberTimelineVideo;
  color: string;
  onOpen: () => void;
}) {
  return (
    <Group
      gap="sm"
      wrap="nowrap"
      className="yt-driver-row"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Разобрать видео «${v.title}»`}
    >
      <Box
        style={{
          width: 10,
          height: 10,
          borderRadius: 3,
          background: cssVar(color),
          flexShrink: 0,
        }}
      />
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
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" lineClamp={1}>
          {v.title}
        </Text>
        {v.publishedAt && (
          <Text size="xs" c="dimmed">
            {formatDate(v.publishedAt)}
          </Text>
        )}
      </Box>
      <Text
        size="sm"
        fw={700}
        c="teal"
        style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
      >
        +{formatCount(v.gained)}
      </Text>
    </Group>
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
    <Paper radius="lg" p={0} bg="transparent">
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
  const er = engagementRate(video);
  return (
    <Paper
      radius="lg"
      className="an-surface yt-video-card"
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

        {/* Лайки и комменты по отдельности сняли — они мало что говорят сами по
            себе. Вместо них ER: действия (лайки+дизлайки+комменты) к просмотрам. */}
        <Group gap="md" wrap="wrap">
          <VideoStat icon={<IconEye size={14} />} value={formatCount(video.viewCount)} />
          {er != null && (
            <Tooltip label="Вовлечённость: (лайки + дизлайки + комменты) / просмотры" withArrow>
              <span>
                <VideoStat icon={<IconHeartHandshake size={14} />} value={formatEr(er)} />
              </span>
            </Tooltip>
          )}
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
  // Длительность знаем из ленты видео; если ролик открыт из лидерборда роста —
  // её нет, тогда просим сервер дотянуть (ось X кривой должна быть в секундах).
  const knownDurationSec = durationToSeconds(video?.duration ?? "");
  useEffect(() => {
    if (!videoId) return;
    let alive = true;
    setState({ s: "loading" });
    // Кэш+prefetch: если карточку наводили, промис уже готов → откроется мгновенно.
    getVideoDetailCached(projectId, videoId, publishedAt, knownDurationSec === 0).then((res) => {
      if (!alive) return;
      setState(res.ok ? { s: "ready", detail: res.data } : { s: "error", msg: res.error });
    });
    return () => {
      alive = false;
    };
  }, [videoId, projectId, publishedAt, knownDurationSec]);

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
            {engagementRate(video) != null && (
              <Tooltip
                label="Вовлечённость: (лайки + дизлайки + комменты) / просмотры"
                withArrow
              >
                <span>
                  <VideoStat
                    icon={<IconHeartHandshake size={16} />}
                    value={`ER ${formatEr(engagementRate(video)!)}`}
                  />
                </span>
              </Tooltip>
            )}
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

          <RetentionSection state={state} durationSec={knownDurationSec} />

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
  // CTR превью: API его не отдаёт, поэтому берём цифрой из Studio, если юзер ввёл.
  const [ctr, setCtr] = useState<string | number>("");

  const run = async () => {
    setSt({ s: "loading" });
    const num = typeof ctr === "number" ? ctr : ctr ? Number(String(ctr).replace(",", ".")) : NaN;
    const res = await apiAnalyzeVideo(projectId, videoId, Number.isFinite(num) ? num : null);
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
        <Group gap="xs" wrap="nowrap" mb="xs">
          <Tooltip
            multiline
            w={260}
            withArrow
            label="CTR превью YouTube по API не отдаёт — он есть только в Studio. Введи цифру оттуда, и я разберу кликабельность по ней."
          >
            <NumberInput
              size="sm"
              w={150}
              min={0}
              max={100}
              step={0.1}
              decimalScale={1}
              placeholder="CTR из Studio"
              suffix=" %"
              value={ctr}
              onChange={setCtr}
              aria-label="CTR превью из YouTube Studio, проценты"
            />
          </Tooltip>
          <Button
            style={{ flex: 1 }}
            color="brand"
            leftSection={<IconSparkles size={18} />}
            onClick={run}
          >
            Разобрать видео с ИИ
          </Button>
        </Group>
        <Text size="xs" c="dimmed" ta="center">
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

function RetentionSection({ state, durationSec }: { state: DetailState; durationSec: number }) {
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
  // По оси X — реальные секунды ролика (доля длины × длительность). Длительность либо
  // знаем из ленты видео, либо её дотянул сервер (detail.duration). Фолбэк на % длины —
  // только если не удалось узнать вообще.
  const sec = durationSec > 0 ? durationSec : durationToSeconds(state.detail.duration ?? "");
  const useSeconds = sec > 0;
  const chartData = curve.map((pt) => ({
    pos: useSeconds ? Math.round(pt.ratio * sec) : Math.round(pt.ratio * 100),
    Удержание: Math.round(pt.watchRatio * 100),
  }));
  const xFormat = (v: number) => (useSeconds ? formatSeconds(v) : `${v}%`);
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
        xAxisProps={{ interval: 19, tickFormatter: xFormat }}
        yAxisProps={{ tickFormatter: (v: number) => `${v}%` }}
        tooltipProps={{
          content: (props: any) => {
            const p = props?.payload?.[0];
            if (!p) return null;
            return (
              <Paper withBorder radius="md" p="xs" shadow="md">
                <Text size="xs" c="dimmed">
                  {useSeconds ? "Время" : "Доля ролика"}: {xFormat(Number(props.label))}
                </Text>
                <Text size="sm" fw={600}>
                  Удержание {p.value}%
                </Text>
              </Paper>
            );
          },
        }}
      />
      <Text size="xs" c="dimmed" mt="xs">
        По горизонтали — {useSeconds ? "секунды ролика" : "доля длины ролика"}, по вертикали —
        сколько зрителей ещё смотрит. Провал в начале = слабый хук.
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
