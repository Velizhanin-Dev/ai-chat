"use client";

import { ytImage } from "@/lib/image-proxy";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconAlertTriangle, IconRefresh, IconTrash, IconUserPlus } from "@tabler/icons-react";
import {
  ALERT_MIN_RATIO,
  type CompetitorChannel,
  type CompetitorVideo,
  type TrackedChannelRow,
  type TrackedFeedResult,
} from "@/lib/competitors";
import {
  apiAddTrackedChannel,
  apiCompetitorContext,
  apiRemoveTrackedChannel,
  apiSetCompetitorAlerts,
  apiTrackedChannels,
  apiTrackedFeed,
  type CompetitorContextView,
} from "@/lib/competitors-client";
import { formatCount } from "@/lib/youtube-client";
import TelegramConnect from "@/components/Settings/TelegramConnect";
import CompetitorCard from "./CompetitorCard";
import AddReferenceModal from "./AddReferenceModal";

// Страница «Конкуренты» — СВОЙ список каналов, за которыми следят постоянно.
//
// Отдельно от «Поиска референсов»: там разовый поиск по нише за 100 units на
// запрос, а здесь список из БД и его лента — ~2 units на канал, смотреть можно
// хоть каждый день.
//
// Что показываем по каждому: последние ролики, соотношение просмотров к
// подписчикам (главная метрика раздела) и тип ролика — шортсы и лонги живут по
// разным законам, и в общей куче это не читается.
export default function CompetitorsList() {
  const params = useParams();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";

  const [ctx, setCtx] = useState<CompetitorContextView | null>(null);
  const [channels, setChannels] = useState<CompetitorChannel[] | null>(null);
  const [feed, setFeed] = useState<TrackedFeedResult | null>(null);
  const [days, setDays] = useState(30);
  // Порог кратности «просмотры / подписчики». 0 = показывать всё.
  //
  // ⚠️ Считается и применяется НА КЛИЕНТЕ, как в поиске референсов: лента уже
  // загружена, крутить порог можно бесплатно и мгновенно. Дефолт 0, а не ×3 как
  // в поиске: там выдача чужая и её надо просеивать, а тут каналы человек выбрал
  // сам — прятать от него их свежие ролики по умолчанию неправильно.
  const [minRatio, setMinRatio] = useState(0);
  const [loading, setLoading] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alertsOn, setAlertsOn] = useState(false);
  const [alertsBusy, setAlertsBusy] = useState(false);
  // Ролик, который кладём референсом в карточку контент-плана.
  const [refVideo, setRefVideo] = useState<CompetitorVideo | null>(null);

  const refreshCtx = useCallback(async () => {
    if (!projectId) return;
    const res = await apiCompetitorContext(projectId);
    if (res.ok) {
      setCtx(res.data);
      setAlertsOn(res.data.alerts);
    }
  }, [projectId]);

  // Список каналов лежит в БД — показываем его сразу, не дожидаясь ленты роликов.
  useEffect(() => {
    if (!projectId) return;
    void refreshCtx();
    apiTrackedChannels(projectId).then((res) => {
      if (res.ok) setChannels(res.data.channels);
      else setError(res.error);
    });
  }, [projectId, refreshCtx]);

  const loadFeed = useCallback(
    async (refresh = false) => {
      if (!projectId) return;
      setLoading(true);
      setError(null);
      const res = await apiTrackedFeed({ projectId, days, refresh });
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFeed(res.data.result);
    },
    [projectId, days]
  );

  // Лента подтягивается сама: без неё страница — просто список названий.
  useEffect(() => {
    if (!projectId || !channels || channels.length === 0) return;
    void loadFeed();
  }, [projectId, channels, loadFeed]);

  const add = async () => {
    const input = addInput.trim();
    if (!projectId || !input) return;
    setAdding(true);
    setError(null);
    const res = await apiAddTrackedChannel({ projectId, input });
    setAdding(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setAddInput("");
    // Повторное добавление того же канала сервер трактует как обновление снимка —
    // поэтому строку заменяем, а не плодим.
    setChannels((cur) => {
      const added = res.data.channel;
      const rest = (cur ?? []).filter((c) => c.id !== added.id);
      return [...rest, added];
    });
  };

  const remove = async (trackedId: string) => {
    if (!projectId) return;
    const res = await apiRemoveTrackedChannel(projectId, trackedId);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setChannels((cur) => (cur ?? []).filter((c) => c.trackedId !== trackedId));
    setFeed((cur) =>
      cur ? { ...cur, channels: cur.channels.filter((c) => c.trackedId !== trackedId) } : cur
    );
  };

  const toggleAlerts = async (on: boolean) => {
    if (!projectId) return;
    setAlertsBusy(true);
    setAlertsOn(on); // оптимистично: тумблер не должен «залипать» на запросе
    const res = await apiSetCompetitorAlerts(projectId, on);
    setAlertsBusy(false);
    if (!res.ok) {
      setAlertsOn(!on);
      setError(res.error);
    }
  };

  // Ролики по каналам: у каждого своя лента, свежие сверху.
  const byChannel = useMemo(() => {
    const map = new Map<string, CompetitorVideo[]>();
    for (const v of feed?.videos ?? []) {
      if (minRatio > 0 && v.ratio < minRatio) continue;
      const list = map.get(v.channelId);
      if (list) list.push(v);
      else map.set(v.channelId, [v]);
    }
    map.forEach((list) => list.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)));
    return map;
  }, [feed, minRatio]);

  // Сколько роликов пережило порог — иначе при жёстком фильтре экран выглядит
  // пустым и непонятно, это фильтр или лента не загрузилась.
  const shownCount = useMemo(
    () => Array.from(byChannel.values()).reduce((n, list) => n + list.length, 0),
    [byChannel]
  );

  const stats = useMemo(() => {
    const map = new Map<string, TrackedChannelRow>();
    for (const c of feed?.channels ?? []) map.set(c.channelId, c);
    return map;
  }, [feed]);

  return (
    <Stack gap="lg" py="md">
      <Box>
        <Title order={2} fz={{ base: "1.35rem", sm: "1.75rem" }}>
          Конкуренты
        </Title>
        <Text c="dimmed" size="sm" mt={4}>
          Каналы, за которыми следим постоянно: что у них выходит и сколько собирает.
          Кратность показывает, вылетел ли ролик за свою аудиторию, — такие и стоит
          разбирать.
        </Text>
      </Box>

      {error && (
        <Alert
          color="red"
          icon={<IconAlertTriangle size={18} />}
          withCloseButton
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      {/* Добавление канала */}
      <Paper className="an-surface" p="md">
        <Group gap="sm" wrap="nowrap" align="flex-end">
          <TextInput
            style={{ flex: 1 }}
            label="Добавить конкурента"
            description="Ссылка на канал или на любой его ролик, @хэндл или channel ID. Можно и просто названием — но по ссылке точнее."
            placeholder="https://youtube.com/@channel, ссылка на ролик или @channel"
            value={addInput}
            onChange={(e) => setAddInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
          />
          <Button
            color="brand"
            leftSection={<IconUserPlus size={16} />}
            onClick={() => void add()}
            loading={adding}
            disabled={!addInput.trim()}
          >
            Добавить
          </Button>
        </Group>
      </Paper>

      {/* Уведомления в телеграм: подписка на «у конкурента залетело».
          ⚠️ Тумблер без привязанного телеграма бессмысленен — слать некуда,
          поэтому вместо него показываем карточку подключения. */}
      <Paper className="an-surface" p="md">
        {ctx?.telegramLinked ? (
          <Group justify="space-between" wrap="wrap" gap="sm">
            <Box style={{ minWidth: 0 }}>
              <Text fw={600}>Уведомления в Telegram</Text>
              <Text size="sm" c="dimmed" mt={4}>
                Напишу в личку, когда у конкурента выйдет ролик и соберёт больше{" "}
                {ALERT_MIN_RATIO} просмотров на подписчика. Проверяю раз в 6 часов, про
                один ролик пишу один раз.
              </Text>
            </Box>
            <Switch
              checked={alertsOn}
              onChange={(e) => void toggleAlerts(e.currentTarget.checked)}
              disabled={alertsBusy}
              color="brand"
              size="md"
              label={alertsOn ? "включены" : "выключены"}
            />
          </Group>
        ) : (
          <TelegramConnect compact onLinked={() => void refreshCtx()} />
        )}
      </Paper>

      {/* Окно ленты */}
      {channels && channels.length > 0 && (
        <Group gap="sm" wrap="wrap">
          <SegmentedControl
            size="xs"
            radius="md"
            color="brand"
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            data={[
              { value: "7", label: "Неделя" },
              { value: "30", label: "Месяц" },
              { value: "90", label: "3 месяца" },
            ]}
            disabled={loading}
          />
          {/* Порог кратности — тот же инструмент, что в поиске референсов: у
              активного канала за месяц выходит два десятка роликов, и вручную
              выискивать среди них выстрелившие бессмысленно. */}
          <SegmentedControl
            size="xs"
            radius="md"
            color="brand"
            value={String(minRatio)}
            onChange={(v) => setMinRatio(Number(v))}
            data={[
              { value: "0", label: "Все" },
              { value: "3", label: "×3" },
              { value: "5", label: "×5" },
              { value: "10", label: "×10" },
            ]}
            disabled={loading}
          />
          <Button
            variant="default"
            size="xs"
            leftSection={<IconRefresh size={14} />}
            onClick={() => void loadFeed(true)}
            loading={loading}
          >
            Обновить
          </Button>
          {feed && (
            <Text size="xs" c="dimmed">
              {minRatio > 0
                ? `подходят ${shownCount} из ${feed.videos.length} за период`
                : `новых роликов за период: ${feed.videos.length}`}
            </Text>
          )}
        </Group>
      )}

      {channels === null ? (
        <Stack gap="md">
          <Skeleton h={140} radius="md" />
          <Skeleton h={140} radius="md" />
        </Stack>
      ) : channels.length === 0 ? (
        <Paper className="an-surface" p="xl">
          <Text ta="center" c="dimmed" size="sm">
            Список пуст. Добавьте каналы вручную выше — или найдите их в «Поиске
            референсов»: там у каждого найденного ролика есть кнопка «в конкуренты».
          </Text>
        </Paper>
      ) : (
        channels.map((c) => {
          const videos = byChannel.get(c.id) ?? [];
          const row = stats.get(c.id);
          return (
            <Paper key={c.id} className="an-surface" p="md">
              <Group justify="space-between" wrap="nowrap" align="flex-start" mb="sm">
                <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                  {c.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={ytImage(c.thumbnail) ?? undefined}
                      alt=""
                      width={40}
                      height={40}
                      style={{ borderRadius: "50%", flexShrink: 0 }}
                    />
                  )}
                  <Box style={{ minWidth: 0 }}>
                    <Anchor href={c.url} target="_blank" rel="noreferrer" fw={700} lineClamp={1}>
                      {c.title}
                    </Anchor>
                    <Group gap={8} wrap="wrap">
                      <Text size="xs" c="dimmed">
                        {formatCount(row?.subscribers ?? c.subscribers)} подписчиков
                      </Text>
                      {/* ⚠️ Прирост считается по НАШИМ снимкам: у YouTube истории нет.
                          Пока снимков меньше двух дней — честно пишем «копим цифры»,
                          а не ноль (ноль читался бы как «канал не растёт»). */}
                      {row && (
                        <Text size="xs" c="dimmed">
                          {row.subsPerWeek == null
                            ? `копим цифры (${row.trackedDays} дн.)`
                            : `${row.subsPerWeek >= 0 ? "+" : ""}${formatCount(
                                row.subsPerWeek
                              )} подписчиков в неделю`}
                        </Text>
                      )}
                    </Group>
                  </Box>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Badge variant="light" color={videos.length ? "brand" : "gray"} radius="sm">
                    {videos.length} за период
                  </Badge>
                  {c.trackedId && (
                    <Tooltip label="Убрать из конкурентов" withArrow>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label={`Убрать ${c.title}`}
                        onClick={() => void remove(c.trackedId as string)}
                      >
                        <IconTrash size={17} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Group>

              {loading && videos.length === 0 ? (
                <Skeleton h={120} radius="md" />
              ) : videos.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {minRatio > 0
                    ? `Роликов с кратностью от ×${minRatio} за период нет.`
                    : "За выбранный период роликов не выходило."}
                </Text>
              ) : (
                <SimpleGrid cols={{ base: 1, xs: 2, md: 3, xl: 4 }} spacing="md">
                  {videos.map((v) => (
                    <CompetitorCard key={v.id} video={v} onAddToPlan={setRefVideo} />
                  ))}
                </SimpleGrid>
              )}
            </Paper>
          );
        })
      )}

      <AddReferenceModal
        projectId={projectId}
        video={refVideo}
        onClose={() => setRefVideo(null)}
      />
    </Stack>
  );
}
