"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAppSelector } from "@/store/hooks";
import CompetitorCard from "./CompetitorCard";
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
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconMessageCircle,
  IconHelpCircle,
  IconSearch,
} from "@tabler/icons-react";
import AddReferenceModal from "./AddReferenceModal";
import KeywordFinder from "./KeywordFinder";
import NicheTagsPanel from "./NicheTagsPanel";
import {
  COMPETITOR_MAX_QUERIES,
  COMPETITOR_PERIODS,
  DEFAULT_FILTERS,
  COMPETITOR_MAX_AUTO_PAGES,
  COMPETITOR_TARGET_RESULTS,
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
  apiAddTrackedChannel,
  apiVideoInsight,
  writeCompetitorsPrompt,
  type CompetitorContextView,
} from "@/lib/competitors-client";
import { formatCount, formatDuration, formatShortDate } from "@/lib/youtube-client";

// Раздел «Поиск референсов» (пока только админам).
//
// ⚠️ Это раздел про РОЛИКИ-доноры, а не про каналы-конкурентов: ищем отдельные
// видео, которые выстрелили за пределы своей аудитории, и кладём их референсом в
// карточку контент-плана.
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

/**
 * Поле панели: одинаковая подпись + контрол единой высоты.
 *
 * ⚠️ Ради этого и заведён: раньше у SegmentedControl была своя мелкая подпись, а у
 * NumberInput — родной label Mantine плюс description на две строки. Подписи разного
 * кегля и разной высоты ломали общую линию, и ряд фильтров выглядел рваным. Длинные
 * пояснения теперь живут в подсказке рядом с подписью, а не растягивают поле.
 */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Box className="cmp-field">
      <span className="cmp-field-label">
        {label}
        {hint && (
          <Tooltip label={hint} withArrow multiline w={240} events={{ hover: true, focus: true, touch: true }}>
            {/* tabIndex — чтобы подсказка открывалась и с клавиатуры, а не только по ховеру. */}
            <IconHelpCircle
              size={14}
              tabIndex={0}
              aria-label={hint}
              style={{ color: "var(--mantine-color-dimmed)", cursor: "help", outlineOffset: 2 }}
            />
          </Tooltip>
        )}
      </span>
      {children}
    </Box>
  );
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

type View = "videos" | "channels" | "feed";

export default function CompetitorsBoard() {
  const params = useParams();
  const router = useRouter();
  const user = useAppSelector((st) => st.auth.user);
  const projectId = typeof params.projectId === "string" ? params.projectId : "";

  const [ctx, setCtx] = useState<CompetitorContextView | null>(null);
  const [ctxLoading, setCtxLoading] = useState(true);

  const [queries, setQueries] = useState<string[]>([]);
  const [periodDays, setPeriodDays] = useState(90);
  const [order, setOrder] = useState<CompetitorOrder>("viewCount");

  const [filters, setFilters] = useState<CompetitorFilters>(DEFAULT_FILTERS);

  const [result, setResult] = useState<CompetitorResult | null>(null);
  // Ролик, который кладём референсом в карточку плана (null — модалка закрыта).
  const [refVideo, setRefVideo] = useState<CompetitorVideo | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Какой канал сейчас добавляем в конкуренты (id) — для лоадера на кнопке.
  const [addingChannel, setAddingChannel] = useState<string | null>(null);
  // Что уже добавили за этот сеанс — чтобы не жать по второму разу вслепую.
  const [added, setAdded] = useState<string[]>([]);
  // Тянем подробности по верхним роликам перед уходом в чат.
  const [analyzing, setAnalyzing] = useState(false);

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

  // Кнопка одна. Решение «искать заново или отдать из памяти» принимает сервер:
  // те же слова с теми же параметрами в пределах 6 часов приходят из кэша и квоту
  // не тратят, любое изменение параметров — живой поиск.
  // mode: "more" — догрузка следующей страницы к уже найденному.
  const run = useCallback(
    async (mode: "search" | "more") => {
      if (!projectId || queries.length === 0) return;
      if (mode === "more") setLoadingMore(true);
      else setSearching(true);
      setError(null);
      saveDraft(projectId, { queries, periodDays, order });
      // filters уходят на сервер не для фильтрации (она клиентская), а как условие
      // остановки: он листает страницы, пока подходящих не станет 20.
      const res = await apiCompetitorSearch({
        projectId,
        queries,
        periodDays,
        order,
        filters,
        mode,
      });
      setSearching(false);
      setLoadingMore(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res.data.result);
      setFromCache(res.data.cached);
      // Пул ключей после поиска подтаял — обновляем счётчик в шапке.
      apiCompetitorContext(projectId).then((c) => {
        if (c.ok) setCtx(c.data);
      });
    },
    [projectId, queries, periodDays, order, filters]
  );
  const search = useCallback(() => run("search"), [run]);

  // «В конкуренты» прямо из выдачи: канал ролика уходит в список на соседней
  // странице. ⚠️ Канал уже известен по id, поэтому это 1 unit (channels.list), а
  // не поиск по названию за 100.
  const addChannelFromVideo = useCallback(
    async (v: CompetitorVideo) => {
      if (!projectId) return;
      setAddingChannel(v.channelId);
      setError(null);
      const res = await apiAddTrackedChannel({ projectId, input: v.channelId });
      setAddingChannel(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAdded((cur) => (cur.includes(v.channelId) ? cur : [...cur, v.channelId]));
    },
    [projectId]
  );

  // Отправить найденное на разбор ассистенту: кладём готовый запрос черновиком
  // в чат и переходим туда (тот же механизм, что у кнопок в разделе «Канал»).
  //
  // ⚠️ По верхним роликам подтягиваем ПОДРОБНОСТИ (описание автора с тайм-кодами
  // и топ-комментарии): по одним названиям ассистент разбирает только заголовок,
  // а нас интересует, на чём ролик держится. Берём пятёрку — этого хватает, чтобы
  // выводы опирались на факты, и промпт не раздувается.
  const askAssistant = useCallback(
    async (list: CompetitorVideo[]) => {
      if (!user || list.length === 0) return;
      setAnalyzing(true);
      const details = await Promise.all(
        list.slice(0, 5).map((v) => apiVideoInsight(projectId, v.id))
      );
      setAnalyzing(false);
      writeCompetitorsPrompt(
        user.id,
        list,
        details.flatMap((r) => (r.ok ? [r.data.insight] : []))
      );
      router.push(`/${projectId}/chat`);
    },
    [projectId, router, user]
  );

  const visible = useMemo(
    () => (result ? applyFilters(result.videos, filters) : []),
    [result, filters]
  );

  // Хватит ли квоты хотя бы на одну страницу поиска. ⚠️ Цифру наружу НЕ выводим
  // (для человека раздел — просто функция), она нужна только чтобы вовремя
  // погасить кнопку и показать понятную причину.
  const pageCost = queries.length * (ctx?.searchCost ?? 100);
  // Блокируем, только если не хватает даже на ОДНУ страницу: остальное поиск
  // доберёт по возможности и остановится сам.
  const notEnoughQuota = Boolean(ctx && ctx.configured && ctx.quota.remaining < pageCost);
  const noQuotaForMore = Boolean(
    ctx && result && ctx.configured && ctx.quota.remaining < result.nextCost
  );

  return (
    <Stack gap="lg" py="md">
      <Box>
        <Title order={2} fz={{ base: "1.35rem", sm: "1.75rem" }}>
          Поиск референсов
        </Title>
        <Text c="dimmed" size="sm" mt={4}>
          Ролики в нише, которые собрали просмотров кратно больше, чем у канала
          подписчиков: такие вылетели за свою аудиторию на упаковке. Кладите их
          референсом в контент-план, а сами каналы — в «Конкуренты», чтобы следить
          за ними постоянно.
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
              description={
                ctx.channelConnected
                  ? `До ${COMPETITOR_MAX_QUERIES} запросов. Подсказки — теги твоих роликов, то есть лексика ниши словами автора.`
                  : `До ${COMPETITOR_MAX_QUERIES} запросов. Канал не подключён, подсказки только из брифа.`
              }
              placeholder={queries.length ? "" : "Например: ремонт мерседес w204"}
              value={queries}
              onChange={(v) => setQueries(v.slice(0, COMPETITOR_MAX_QUERIES))}
              data={ctx.suggested}
              maxTags={COMPETITOR_MAX_QUERIES}
              // Вставили перечисление через запятую — раскладываем на отдельные
              // запросы. Иначе строка «ремонт, диагностика, обслуживание» уходила
              // в поиск целиком и не находила ничего.
              splitChars={[",", ";"]}
              clearable
            />

            {/* Подбор ключей стоит ВПЛОТНУЮ к полю запросов и наполняет именно его:
                это не отдельный инструмент «посмотреть цифры», а шаг перед поиском —
                выбрал живую формулировку, по ней и ищем чужие ролики. */}
            <KeywordFinder
              slotsLeft={COMPETITOR_MAX_QUERIES - queries.length}
              onPick={(phrase) =>
                setQueries((cur) =>
                  cur.includes(phrase) || cur.length >= COMPETITOR_MAX_QUERIES
                    ? cur
                    : [...cur, phrase]
                )
              }
            />

            <Box className="cmp-fields">
              <Field label="Ролики за период">
                <SegmentedControl
                  size="sm"
                  value={String(periodDays)}
                  onChange={(v) => setPeriodDays(Number(v))}
                  data={COMPETITOR_PERIODS.map((p) => ({
                    value: String(p.value),
                    label: p.label,
                  }))}
                />
              </Field>

              <Field label="Что берём из выдачи">
                <Select
                  className="cmp-select"
                  size="sm"
                  value={order}
                  onChange={(v) => setOrder((v as CompetitorOrder) ?? "viewCount")}
                  data={[
                    { value: "viewCount", label: "Самые просматриваемые" },
                    { value: "relevance", label: "Самые релевантные" },
                    { value: "date", label: "Самые свежие" },
                  ]}
                  allowDeselect={false}
                />
              </Field>

              {/* Кнопка без подписи — .cmp-fields выравнивает по нижнему краю,
                  поэтому она встаёт ровно на линию контролов. */}
              <Button
                leftSection={<IconSearch size={16} />}
                onClick={search}
                loading={searching}
                disabled={queries.length === 0 || notEnoughQuota}
                h={36}
              >
                Найти
              </Button>
            </Box>

            {/* ⚠️ Про units квоты и остаток по ключам тут НЕ пишем: это наша
                внутренняя кухня, для человека раздел — просто рабочая функция.
                Состояние пула ключей видно в админке (/admin/flags). */}
            <Text size="xs" c="dimmed">
              Ищем, пока не наберётся {COMPETITOR_TARGET_RESULTS} подходящих роликов.
              Фильтры ниже крутятся по уже найденному — бесплатно и мгновенно.
            </Text>

            {notEnoughQuota && (
              <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
                Поиск сегодня недоступен — лимит запросов к YouTube исчерпан. Он
                обновится ночью, найденное раньше открывается как обычно.
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
            <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
              <Box className="cmp-fields">
                <Field
                  label="Кратность"
                  hint="Во сколько раз просмотров больше, чем подписчиков у канала. ×5 — ролик вылетел за свою аудиторию на упаковке."
                >
                  <SegmentedControl
                    size="sm"
                    value={String(filters.minRatio)}
                    onChange={(v) => setFilters((f) => ({ ...f, minRatio: Number(v) }))}
                    data={RATIO_PRESETS}
                  />
                </Field>

                <Field
                  label="Просмотров от"
                  hint="Отсекает мелочь вроде 10 просмотров на 1 подписчика: кратность там огромная, а разбирать нечего."
                >
                  <NumberInput
                    className="cmp-num"
                    size="sm"
                    min={0}
                    step={500}
                    thousandSeparator=" "
                    value={filters.minViews}
                    onChange={(v) => setFilters((f) => ({ ...f, minViews: Number(v) || 0 }))}
                    aria-label="Минимум просмотров"
                  />
                </Field>

                <Field label="Тип">
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
                </Field>
              </Box>

              {/* Итог фильтрации — не мелкой сноской внизу, а рядом с фильтрами:
                  это прямой отклик на кручение ручек, его и надо видеть. */}
              <Box ta={{ base: "left", sm: "right" }}>
                <Text fw={700} fz="1.35rem" style={{ letterSpacing: "-0.02em" }}>
                  {visible.length}{" "}
                  <Text span c="dimmed" fz="sm" fw={400}>
                    из {result.scanned}
                  </Text>
                </Text>
                <Text size="xs" c="dimmed">
                  подходит под фильтр
                </Text>
              </Box>
            </Group>

            <Text size="xs" c="dimmed" mt="sm">
              {result.foreign > 0 && `Отсеяно иноязычных: ${result.foreign}`}
              {result.foreign > 0 && result.hiddenSubs > 0 && " · "}
              {result.hiddenSubs > 0 &&
                `со скрытым счётчиком подписчиков: ${result.hiddenSubs}`}
              {(result.foreign > 0 || result.hiddenSubs > 0) && " · "}
              {fromCache ? "показано из памяти, найдено " : "найдено "}
              {new Date(result.fetchedAt).toLocaleString("ru-RU", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </Paper>

          {visible.length > 0 && (
            <Group justify="space-between" align="center" gap="sm" wrap="wrap">
              {/* Теги тех, у кого в этой нише уже сработало: лексика, которой
                  зритель ищет тему. В Data API их нет — см. NicheTagsPanel. */}
              <NicheTagsPanel videos={visible} />
              <Button
                variant="light"
                color="brand"
                leftSection={<IconMessageCircle size={16} />}
                onClick={() => void askAssistant(visible)}
                loading={analyzing}
              >
                Разобрать упаковку с ассистентом
              </Button>
            </Group>
          )}

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
                <CompetitorCard
                  key={v.id}
                  video={v}
                  onAddToPlan={setRefVideo}
                  onAddChannel={(x: CompetitorVideo) => void addChannelFromVideo(x)}
                  addedChannel={added.includes(v.channelId)}
                  addingChannel={addingChannel === v.channelId}
                />
              ))}
            </SimpleGrid>
          )}

          {/* Догрузка выдачи. Цену (units) человеку не показываем — это внутренняя
              кухня; кнопка просто гаснет, если на сегодня запросов не осталось. */}
          {result.hasMore && (
            <Group justify="center" gap="xs" mt="xs">
              <Button
                variant="default"
                onClick={() => run("more")}
                loading={loadingMore}
                disabled={noQuotaForMore}
              >
                Добрать ещё {COMPETITOR_TARGET_RESULTS}
              </Button>

            </Group>
          )}
          {!result.hasMore && result.pagesLoaded > 1 && (
            <Text size="xs" c="dimmed" ta="center">
              Это вся выдача, что YouTube отдаёт по этим запросам.
            </Text>
          )}
        </>
      )}

      <AddReferenceModal
        projectId={projectId}
        video={refVideo}
        onClose={() => setRefVideo(null)}
      />
    </Stack>
  );
}
