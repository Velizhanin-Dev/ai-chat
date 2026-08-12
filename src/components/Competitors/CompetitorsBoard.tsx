"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  TagsInput,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconExternalLink,
  IconFlame,
  IconRefresh,
  IconSearch,
  IconUsers,
} from "@tabler/icons-react";
import {
  COMPETITOR_MAX_QUERIES,
  COMPETITOR_PERIODS,
  DEFAULT_FILTERS,
  applyFilters,
  formatRatio,
  type CompetitorFilters,
  type CompetitorKind,
  type CompetitorOrder,
  type CompetitorResult,
  type CompetitorVideo,
} from "@/lib/competitors";
import {
  apiCompetitorContext,
  apiCompetitorSearch,
  type CompetitorContextView,
} from "@/lib/competitors-client";
import { formatCount, formatDuration, formatShortDate } from "@/lib/youtube-client";

// Раздел «Конкуренты в нише» (пока только админам).
//
// Ищем в YouTube ролики по ключевым словам ниши и показываем те, у которых
// просмотров НЕСОИЗМЕРИМО больше, чем подписчиков у канала: 500 просмотров при
// 100 подписчиках = ×5. Такой ролик вылетел за свою аудиторию — значит сработала
// упаковка (название, превью, тема), и её можно разобрать и перенести к себе.
//
// ⚠️ Поиск ДОРОГОЙ: один запрос = 100 units квоты YouTube (обычный вызов = 1),
// поэтому он идёт только по кнопке и по своему пулу ключей с ротацией. А вот
// фильтры (порог, минимум просмотров, шортсы/лонги) считаются на клиенте по уже
// полученной выдаче — крутить их можно сколько угодно, квота не тратится.

const DRAFT_KEY = "creative-chat:competitors-v1";

interface Draft {
  queries: string[];
  periodDays: number;
  order: CompetitorOrder;
}

function loadDraft(projectId: string): Draft | null {
  try {
    const raw = localStorage.getItem(`${DRAFT_KEY}:${projectId}`);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function saveDraft(projectId: string, d: Draft): void {
  try {
    localStorage.setItem(`${DRAFT_KEY}:${projectId}`, JSON.stringify(d));
  } catch {
    /* приватный режим — не беда */
  }
}

const RATIO_PRESETS = [
  { value: "3", label: "×3" },
  { value: "5", label: "×5" },
  { value: "10", label: "×10" },
  { value: "20", label: "×20" },
];

export default function CompetitorsBoard() {
  const params = useParams();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";

  const [ctx, setCtx] = useState<CompetitorContextView | null>(null);
  const [ctxLoading, setCtxLoading] = useState(true);

  const [queries, setQueries] = useState<string[]>([]);
  const [periodDays, setPeriodDays] = useState(90);
  const [order, setOrder] = useState<CompetitorOrder>("viewCount");

  const [filters, setFilters] = useState<CompetitorFilters>(DEFAULT_FILTERS);

  const [result, setResult] = useState<CompetitorResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Контекст: подсказки запросов из брифа и тегов канала + состояние пула ключей.
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setCtxLoading(true);
    apiCompetitorContext(projectId).then((res) => {
      if (!alive) return;
      setCtxLoading(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCtx(res.data);
      // Запросы: сохранённые с прошлого раза, иначе первые подсказки.
      const draft = loadDraft(projectId);
      if (draft?.queries?.length) {
        setQueries(draft.queries.slice(0, COMPETITOR_MAX_QUERIES));
        setPeriodDays(draft.periodDays ?? 90);
        setOrder(draft.order ?? "viewCount");
      } else {
        setQueries(res.data.suggested.slice(0, 3));
      }
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const search = useCallback(
    async (force: boolean) => {
      if (!projectId || queries.length === 0) return;
      setSearching(true);
      setError(null);
      saveDraft(projectId, { queries, periodDays, order });
      const res = await apiCompetitorSearch({
        projectId,
        queries,
        periodDays,
        order,
        force,
      });
      setSearching(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res.data.result);
      // Пул ключей после поиска подтаял — обновляем счётчик в шапке.
      apiCompetitorContext(projectId).then((c) => {
        if (c.ok) setCtx(c.data);
      });
    },
    [projectId, queries, periodDays, order]
  );

  const visible = useMemo(
    () => (result ? applyFilters(result.videos, filters) : []),
    [result, filters]
  );

  const cost = queries.length * (ctx?.searchCost ?? 100);
  const notEnoughQuota = Boolean(ctx && ctx.configured && ctx.quota.remaining < cost);

  return (
    <Stack gap="lg" py="md">
      <Box>
        <Title order={2} fz={{ base: "1.35rem", sm: "1.75rem" }}>
          Конкуренты в нише
        </Title>
        <Text c="dimmed" size="sm" mt={4}>
          Ролики, которые собрали просмотров кратно больше, чем у канала подписчиков.
          Такие вылетели за свою аудиторию на упаковке — их и стоит разбирать.
        </Text>
      </Box>

      {ctxLoading && <Skeleton h={160} radius="md" />}

      {!ctxLoading && ctx && !ctx.configured && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Поиск не настроен">
          Не заданы ключи YouTube API (переменная <code>YOUTUBE_API_KEYS</code>). Раздел ищет
          по публичному API отдельным пулом ключей, чтобы не тратить квоту аналитики.
        </Alert>
      )}

      {!ctxLoading && ctx?.configured && (
        <Paper className="an-surface" p="md">
          <Stack gap="md">
            <TagsInput
              label="Ключевые слова ниши"
              description={`До ${COMPETITOR_MAX_QUERIES} запросов. Подсказки собраны из брифа и тегов твоих роликов — правь как хочешь.`}
              placeholder={queries.length ? "" : "Например: ремонт мерседес w204"}
              value={queries}
              onChange={(v) => setQueries(v.slice(0, COMPETITOR_MAX_QUERIES))}
              data={ctx.suggested}
              maxTags={COMPETITOR_MAX_QUERIES}
              clearable
            />

            <Group gap="md" align="flex-end" wrap="wrap">
              <Box>
                <Text size="xs" c="dimmed" mb={6}>
                  Ролики за период
                </Text>
                <SegmentedControl
                  size="sm"
                  value={String(periodDays)}
                  onChange={(v) => setPeriodDays(Number(v))}
                  data={COMPETITOR_PERIODS.map((p) => ({
                    value: String(p.value),
                    label: p.label,
                  }))}
                />
              </Box>

              <Select
                label="Что берём из выдачи"
                size="sm"
                w={220}
                value={order}
                onChange={(v) => setOrder((v as CompetitorOrder) ?? "viewCount")}
                data={[
                  { value: "viewCount", label: "Самые просматриваемые" },
                  { value: "relevance", label: "Самые релевантные" },
                  { value: "date", label: "Самые свежие" },
                ]}
                allowDeselect={false}
              />

              <Group gap="xs">
                <Button
                  leftSection={<IconSearch size={16} />}
                  onClick={() => search(false)}
                  loading={searching}
                  disabled={queries.length === 0 || notEnoughQuota}
                >
                  Найти
                </Button>
                {result && (
                  <Tooltip label="Искать заново, мимо кэша (тратит квоту)" withArrow>
                    <Button
                      variant="default"
                      leftSection={<IconRefresh size={16} />}
                      onClick={() => search(true)}
                      loading={searching}
                      disabled={notEnoughQuota}
                    >
                      Обновить
                    </Button>
                  </Tooltip>
                )}
              </Group>
            </Group>

            {/* Цена поиска и остаток квоты — админу важно видеть до нажатия. */}
            <Group gap="xs" wrap="wrap">
              <Text size="xs" c="dimmed">
                Поиск обойдётся в <b>{cost}</b> units квоты · осталось сегодня{" "}
                <b>{ctx.quota.remaining.toLocaleString("ru-RU")}</b> на{" "}
                {ctx.quota.keys.length}{" "}
                {ctx.quota.keys.length === 1 ? "ключе" : "ключах"}
              </Text>
              {ctx.quota.keys.some((k) => k.dead) && (
                <Badge color="gray" size="sm" variant="light">
                  выбыло ключей: {ctx.quota.keys.filter((k) => k.dead).length}
                </Badge>
              )}
              {!ctx.channelConnected && (
                <Badge color="gray" size="sm" variant="light">
                  канал не подключён — подсказки только из брифа
                </Badge>
              )}
            </Group>

            {notEnoughQuota && (
              <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
                На сегодня квоты не хватает. Она сбрасывается в полночь по тихоокеанскому
                времени, либо добавьте ещё ключ в <code>YOUTUBE_API_KEYS</code>.
              </Alert>
            )}
          </Stack>
        </Paper>
      )}

      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}

      {searching && !result && (
        <Center py="xl">
          <Stack align="center" gap="xs">
            <Loader />
            <Text size="sm" c="dimmed">
              Ищу по {queries.length}{" "}
              {queries.length === 1 ? "запросу" : "запросам"}…
            </Text>
          </Stack>
        </Center>
      )}

      {result && (
        <>
          <Paper className="an-surface" p="md">
            <Group gap="lg" align="flex-end" wrap="wrap">
              <Box>
                <Text size="xs" c="dimmed" mb={6}>
                  Просмотров на подписчика — не меньше
                </Text>
                <SegmentedControl
                  size="sm"
                  value={String(filters.minRatio)}
                  onChange={(v) => setFilters((f) => ({ ...f, minRatio: Number(v) }))}
                  data={RATIO_PRESETS}
                />
              </Box>

              <NumberInput
                label="Минимум просмотров"
                description="Отсекает мелочь вроде 10 просмотров на 1 подписчика"
                size="sm"
                w={200}
                min={0}
                step={500}
                thousandSeparator=" "
                value={filters.minViews}
                onChange={(v) => setFilters((f) => ({ ...f, minViews: Number(v) || 0 }))}
              />

              <Box>
                <Text size="xs" c="dimmed" mb={6}>
                  Тип
                </Text>
                <SegmentedControl
                  size="sm"
                  value={filters.kind}
                  onChange={(v) => setFilters((f) => ({ ...f, kind: v as CompetitorKind }))}
                  data={[
                    { value: "all", label: "Все" },
                    { value: "long", label: "Видео" },
                    { value: "shorts", label: "Shorts" },
                  ]}
                />
              </Box>
            </Group>

            <Text size="xs" c="dimmed" mt="sm">
              Просмотрено роликов: {result.scanned} · подходит под фильтр: {visible.length}
              {result.hiddenSubs > 0 &&
                ` · пропущено со скрытым счётчиком подписчиков: ${result.hiddenSubs}`}
            </Text>
          </Paper>

          {visible.length === 0 ? (
            <Paper className="an-surface" p="xl">
              <Text ta="center" c="dimmed" size="sm">
                Под фильтр ничего не подошло. Снизьте порог, расширьте период или
                поменяйте ключевые слова — по узкому запросу выдача бывает пустой.
              </Text>
            </Paper>
          ) : (
            <SimpleGrid cols={{ base: 1, xs: 2, md: 3, xl: 4 }} spacing="md">
              {visible.map((v) => (
                <CompetitorCard key={v.id} video={v} />
              ))}
            </SimpleGrid>
          )}
        </>
      )}
    </Stack>
  );
}

function CompetitorCard({ video }: { video: CompetitorVideo }) {
  return (
    <Paper
      className="an-surface yt-video-card"
      component="a"
      href={`https://www.youtube.com/watch?v=${video.id}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{ overflow: "hidden", display: "block", color: "inherit", textDecoration: "none" }}
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

        {/* Главная цифра карточки — во сколько раз просмотры обогнали подписчиков. */}
        <Badge
          leftSection={<IconFlame size={13} />}
          radius="sm"
          style={{
            position: "absolute",
            left: 8,
            top: 8,
            background: "var(--mantine-color-brand-filled)",
            color: "#fff",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatRatio(video.ratio)}
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
              src={video.channelThumb}
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
    </Paper>
  );
}
