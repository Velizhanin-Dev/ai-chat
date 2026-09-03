"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Select,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCalendarPlus,
  IconDownload,
  IconPlus,
  IconRefresh,
  IconSparkles,
} from "@tabler/icons-react";
import { useAppDispatch } from "@/store/hooks";
import { bumpRequestsUsed } from "@/store/authSlice";
import {
  apiAddVideo,
  apiContentPlan,
  apiContentPlans,
  apiGenerateBlock,
  apiGeneratePlan,
  findPendingPlanJobs,
  apiResyncPlan,
  apiReorderVideos,
  apiUpdateVideo,
} from "@/lib/content-plan-client";
import {
  BLOCK_META,
  BOARD_COLUMNS,
  CONTENT_PLAN_GENERATE_QUOTA_COST,
  PLAN_VIDEO_COUNT,
  STATUS_META,
  type BlockKey,
  type ContentPlanMeta,
  type LinkVideo,
  type ContentPlanView,
  type VideoStatus,
  type VideoView,
} from "@/lib/content-plan";
import { waitForJob } from "@/lib/jobs-client";
import { videoIdFromUrl } from "@/lib/competitors";
import LinkVideoModal from "./LinkVideoModal";
import SupportBlocks from "./SupportBlocks";
import TopicEvidencePanel from "./TopicEvidence";
import VideoCard from "./VideoCard";
import VideoDrawer from "./VideoDrawer";

export default function ContentPlanBoard() {
  const params = useParams();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  const dispatch = useAppDispatch();

  const [plans, setPlans] = useState<ContentPlanMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [plan, setPlan] = useState<ContentPlanView | null>(null);
  const [loading, setLoading] = useState(true);
  const [planLoading, setPlanLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<VideoView | null>(null);
  const [dragId, setDragId] = useState<string | null>(null); // перетаскиваемый ролик
  const [importOpen, setImportOpen] = useState(false); // пикер импорта с канала
  const [resyncing, setResyncing] = useState(false); // обновление цифр с канала
  const [blockBusy, setBlockBusy] = useState<BlockKey | null>(null); // какой блок собирается
  // ⚠️ Доска показывает ОДИН тип за раз. Раньше на ней жили только лонги, а шортсы
  // висели отдельной сеткой без статусов — поставил шортсу «в работе», и он не
  // двигался никуда: колонок для него на доске просто не было, и человек считал,
  // что карточка потерялась. Теперь у шортсов те же колонки, переключатель сверху.
  const [boardKind, setBoardKind] = useState<"video" | "short">("video");

  const openPlan = useCallback(async (id: string) => {
    setPlanLoading(true);
    setActiveId(id);
    const res = await apiContentPlan(id);
    setPlan(res.ok ? res.data.plan : null);
    setPlanLoading(false);
    // Цифры у привязанных роликов — снимок на момент привязки. Освежаем их из
    // кэша канала (квоту не тратит, YouTube лишний раз не дёргает).
    if (res.ok && res.data.plan.videos.some((v) => v.youtubeVideoId)) {
      const sync = await apiResyncPlan(id);
      if (sync.ok && sync.data.plan) setPlan(sync.data.plan);
    }
  }, []);

  // Кнопка «Обновить цифры» — принудительно, мимо кэша канала.
  const resync = async () => {
    if (!activeId) return;
    setResyncing(true);
    const res = await apiResyncPlan(activeId, true);
    setResyncing(false);
    if (res.ok && res.data.plan) setPlan(res.data.plan);
    else if (!res.ok) setError(res.error);
  };

  // Опорный блок (портреты ЦА / Хант / воронка / шортсы).
  const generateBlock = async (block: BlockKey) => {
    if (!activeId) return;
    setBlockBusy(block);
    setError(null);
    const res = await apiGenerateBlock(activeId, block);
    setBlockBusy(null);
    if (res.ok) {
      setPlan(res.data.plan);
      dispatch(bumpRequestsUsed(BLOCK_META[block].cost));
    } else setError(res.error);
  };

  useEffect(() => {
    let alive = true;
    apiContentPlans(projectId).then((res) => {
      if (!alive) return;
      const list = res.ok ? res.data.plans : [];
      setPlans(list);
      setLoading(false);
      if (list.length) void openPlan(list[0].id);
    });

    // ⚠️ Подхват ИДУЩЕЙ генерации. Сборка плана — фоновая задача: человек жмёт
    // кнопку, уходит со страницы (или возвращается по крутилке задач), а при
    // повторном заходе доска ничего про задачу не знала — пустое состояние
    // показывало АКТИВНУЮ кнопку «Сгенерировать план» поверх работающей
    // генерации. Повторный клик денег не тратил (findRunningJob на сервере
    // отдаёт ту же задачу), но выглядело как «ничего не запустилось».
    // findPendingPlanJobs был написан ровно под это — и не был подключён.
    void (async () => {
      const jobs = await findPendingPlanJobs(projectId);
      if (!alive || jobs.length === 0) return;
      if (jobs.some((j) => j.kind === "content_plan_generate")) setGenerating(true);

      const results = await Promise.all(jobs.map((j) => waitForJob(j.id).catch(() => null)));
      if (!alive) return;
      setGenerating(false);
      const gen = results.find((j, i) => jobs[i].kind === "content_plan_generate");
      if (gen && gen.status === "error") {
        setError(gen.error || "Не удалось собрать план");
      }
      // Результаты (план + опорные блоки, которые воркер ставит следом) уже в
      // БД — просто перечитываем список и открываем свежий план.
      const res = await apiContentPlans(projectId);
      if (!alive || !res.ok) return;
      setPlans(res.data.plans);
      if (res.data.plans.length) void openPlan(res.data.plans[0].id);
    })();

    return () => {
      alive = false;
    };
  }, [projectId, openPlan]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    const res = await apiGeneratePlan(projectId);
    setGenerating(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const p = res.data.plan;
    setPlan(p);
    setActiveId(p.id);
    setPlans((prev) => [metaOf(p), ...prev]);
    dispatch(bumpRequestsUsed(CONTENT_PLAN_GENERATE_QUOTA_COST));
  };

  const addVideo = async () => {
    if (!activeId) return;
    // Тип новой карточки — тот, что открыт на доске: жмёшь «+» на доске шортсов и
    // получаешь шортс, иначе он бы уехал в другой тип и «пропал».
    const res = await apiAddVideo(activeId, { kind: boardKind === "short" ? "short" : "video" });
    if (res.ok) {
      setPlan((prev) => (prev ? { ...prev, videos: [...prev.videos, res.data.video] } : prev));
      setDrawer(res.data.video);
    }
  };

  // Свалка идей: одно поле, куда кидают мысль или ссылку.
  //
  // ⚠️ Ссылку на ролик РАСПОЗНАЁМ и кладём в поле «референс», а не в название:
  // иначе на карточке висел бы нечитаемый https://… вместо смысла, и главное —
  // потерялась бы возможность потом переработать этого донора по методике
  // (кнопка в карточке ищет референс, а не текст).
  const quickAdd = async (text: string) => {
    if (!activeId) return;
    const isLink = /^https?:\/\//i.test(text) || videoIdFromUrl(text) !== null;
    const res = await apiAddVideo(activeId, {
      status: "dump",
      ...(isLink ? { reference: text } : { title: text }),
    });
    if (res.ok) {
      setPlan((prev) => (prev ? { ...prev, videos: [...prev.videos, res.data.video] } : prev));
    }
  };

  // Импорт уже опубликованного ролика канала → карточка сразу «опубликовано».
  const importVideo = async (v: LinkVideo) => {
    if (!activeId) return;
    setImportOpen(false);
    const res = await apiAddVideo(activeId, {
      title: v.title,
      youtubeVideoId: v.id,
      thumbnail: v.thumbnail,
      views: v.views,
    });
    if (res.ok) {
      setPlan((prev) => (prev ? { ...prev, videos: [...prev.videos, res.data.video] } : prev));
    }
  };

  // ⚠️⚠️ Все правки карточек идут по ОБОИМ спискам — videos и carried. Карточка из
  // другого месяца лежит в carried, и если её там не обновить, любое действие над
  // ней (перенос, правка, удаление) не отражалось бы на экране до перезагрузки —
  // ровно тот симптом «колонка не работает», который уже ловили с DnD.
  const onVideoChange = (video: VideoView) =>
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            videos: prev.videos.map((v) => (v.id === video.id ? video : v)),
            carried: prev.carried.map((v) =>
              // planLabel живёт только в carried — при подмене его надо сохранить,
              // иначе карточка «потеряет» подпись, из какого она месяца.
              v.id === video.id ? { ...video, planLabel: v.planLabel } : v
            ),
          }
        : prev
    );
  const onVideoDelete = (id: string) =>
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            videos: prev.videos.filter((v) => v.id !== id),
            carried: prev.carried.filter((v) => v.id !== id),
          }
        : prev
    );

  // DnD: бросили карточку в колонку → и переезд, и место в списке одним запросом.
  //
  // ⚠️ index — куда встать ВНУТРИ колонки (сортировка карточек между собой), а не
  // просто «в эту колонку»: сначала переносить умели только между колонками, и
  // порядок внутри одной оставался тем, в котором их создали.
  const moveVideo = async (id: string, status: VideoStatus, index?: number) => {
    setDragId(null);
    if (!plan) return;
    // ⚠️ Ищем среди ОБОИХ списков: карточка может быть из другого месяца (carried).
    const all = [...plan.videos, ...plan.carried];
    const current = all.find((v) => v.id === id);
    if (!current) return;

    // Итоговый список колонки: убираем карточку с её прежнего места (если она уже
    // тут) и вставляем на нужную позицию. Свалка не делится по типу — там в одной
    // куче и будущие лонги, и будущие шортсы.
    const sameLane = (v: VideoView) =>
      status === "dump" ? true : (v.kind === "short") === (current.kind === "short");
    const column = all
      .filter((v) => sameLane(v) && v.status === status && v.id !== id)
      .sort((a, b) => a.order - b.order);
    const at = index == null ? column.length : Math.max(0, Math.min(index, column.length));
    const ids = [...column.slice(0, at).map((v) => v.id), id, ...column.slice(at).map((v) => v.id)];

    // Уже стоит ровно там же — не гоняем запрос.
    const before = all
      .filter((v) => sameLane(v) && v.status === status)
      .sort((a, b) => a.order - b.order)
      .map((v) => v.id);
    if (before.length === ids.length && before.every((x, i) => x === ids[i])) return;

    const snapshot = { videos: plan.videos, carried: plan.carried };
    const apply = (list: VideoView[]) =>
      list.map((v) => {
        const pos = ids.indexOf(v.id);
        return pos === -1 ? v : { ...v, status, order: pos };
      });
    // Оптимистично: статус и порядок сразу, чтобы карточка не «прыгала» обратно.
    setPlan((prev) =>
      prev ? { ...prev, videos: apply(prev.videos), carried: apply(prev.carried) } : prev
    );

    const res = await apiReorderVideos(plan.id, status, ids);
    if (res.ok) {
      // ⚠️ Ответ сервера подставляем ТОЛЬКО в свои карточки: он перечисляет
      // ролики этого плана, и подмена им carried стёрла бы чужие. Для карточек
      // других месяцев достаточно оптимистичного обновления выше — сервер их
      // порядок уже записал.
      setPlan((prev) => (prev ? { ...prev, videos: res.data.videos } : prev));
    } else {
      setPlan((prev) => (prev ? { ...prev, ...snapshot } : prev));
      setError("Не удалось перенести ролик");
    }
  };

  // Раскладка карточек по колонкам. Сюда же подмешиваются карточки из ДРУГИХ
  // планов проекта (plan.carried): свалка и работа в процессе не заканчиваются
  // вместе с месяцем — см. комментарий к carried в content-plan.ts.
  const byStatus = useMemo(() => {
    const map: Record<VideoStatus, VideoView[]> = {
      dump: [],
      idea: [],
      in_progress: [],
      published: [],
      cancelled: [],
    };
    // ⚠️ Свалка живёт ВНЕ деления на видео и шортсы: в неё кидают мысль, ещё не
    // зная, во что она вырастет. Поэтому она одинакова на обеих вкладках, а не
    // прячет половину записей за переключателем.
    const all = [...(plan?.videos ?? []), ...(plan?.carried ?? [])];
    for (const v of all) {
      if (v.status === "dump") {
        map.dump.push(v);
        continue;
      }
      const isShort = v.kind === "short";
      if (isShort === (boardKind === "short")) map[v.status].push(v);
    }
    // Внутри колонки — по order: это ручной порядок, который человек выставил
    // перетаскиванием (сервер отдаёт план тем же порядком, но после оптимистичного
    // обновления массив ещё не пересортирован).
    for (const key of Object.keys(map) as VideoStatus[]) {
      map[key].sort((a, b) => a.order - b.order);
    }
    return map;
  }, [plan, boardKind]);

  const shorts = useMemo(
    () => (plan?.videos ?? []).filter((v) => v.kind === "short" && v.status !== "dump"),
    [plan]
  );

  // Сколько карточек каждого типа — цифра прямо на переключателе, чтобы человек
  // видел, что шортсы вообще есть, даже когда открыт другой тип.
  const counts = useMemo(
    () => ({
      // ⚠️ Свалку в счётчик НЕ берём: там сырые записи, а цифра отвечает на
      // вопрос «сколько роликов в плане».
      video: (plan?.videos ?? []).filter((v) => v.kind !== "short" && v.status !== "dump").length,
      short: shorts.length,
    }),
    [plan, shorts]
  );

  // Количество роликов фиксировано (PLAN_VIDEO_COUNT) — выбора у пользователя нет,
  // поэтому это простая кнопка, а не поповер с настройками.
  const genControl = (
    <Tooltip
      label={`${PLAN_VIDEO_COUNT} роликов по методике · ${CONTENT_PLAN_GENERATE_QUOTA_COST} запросов`}
      withArrow
    >
      <Button
        color="brand"
        leftSection={<IconSparkles size={16} />}
        loading={generating}
        onClick={generate}
      >
        {plans.length ? "Новый план" : "Сгенерировать план"}
      </Button>
    </Tooltip>
  );

  return (
    <Stack gap="lg">
      {!loading && plans.length > 0 && (
        <Group justify="flex-end" visibleFrom="sm">
          {genControl}
        </Group>
      )}

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} onClose={() => setError(null)} withCloseButton>
          {error}
        </Alert>
      )}

      {loading ? (
        <Skeleton height={280} radius="lg" />
      ) : plans.length === 0 ? (
        <EmptyState control={genControl} generating={generating} />
      ) : (
        <>
          {/* Переключатель месяца (прошлые — тут же, «скрыты» до выбора) */}
          <Group gap="sm" wrap="wrap">
            <Select
              label={undefined}
              w={260}
              value={activeId}
              onChange={(id) => id && openPlan(id)}
              data={plans.map((p) => ({
                value: p.id,
                label: `${p.label} · ${p.videoCount} видео`,
              }))}
              comboboxProps={{ withinPortal: true }}
              allowDeselect={false}
            />
            <Button
              variant="default"
              leftSection={<IconDownload size={15} />}
              onClick={() => setImportOpen(true)}
            >
              Импорт с канала
            </Button>
            <Tooltip label="Обновить просмотры у привязанных роликов" withArrow>
              <Button
                variant="default"
                leftSection={<IconRefresh size={15} />}
                onClick={resync}
                loading={resyncing}
              >
                Обновить цифры
              </Button>
            </Tooltip>
            <Box hiddenFrom="sm">{genControl}</Box>
          </Group>

          {planLoading || !plan ? (
            <Skeleton height={280} radius="lg" />
          ) : (
            <>
              {/* Переключатель типа: у шортсов свои колонки и свой порядок.
                  Показываем всегда — иначе непонятно, что доска умеет оба типа. */}
              <Group justify="space-between" align="center" gap="sm" wrap="wrap">
                <SegmentedControl
                  size="md"
                  radius="md"
                  color="brand"
                  fw={600}
                  value={boardKind}
                  onChange={(v) => setBoardKind(v as "video" | "short")}
                  data={[
                    { value: "video", label: `Видео (${counts.video})` },
                    { value: "short", label: `Shorts (${counts.short})` },
                  ]}
                />
                {/* ⚠️ Сборка сетки шортсов переехала СЮДА из опорных блоков внизу.
                    Причина: карточки шортсов давно живут на доске со своими
                    статусами, а кнопка их создания оставалась в другом конце
                    страницы — человек её просто не находил. Показываем только на
                    вкладке шортсов и только пока их нет: дальше карточки
                    добавляются обычным «+ Ролик». */}
                {boardKind === "short" && counts.short === 0 && (
                  <Button
                    size="compact-sm"
                    variant="light"
                    color="brand"
                    leftSection={<IconSparkles size={15} />}
                    loading={blockBusy === "shorts"}
                    onClick={() => void generateBlock("shorts")}
                  >
                    Собрать сетку шортсов · {BLOCK_META.shorts.cost}
                  </Button>
                )}
              </Group>

              <Box className="cp-board">
                {BOARD_COLUMNS.map((status) => (
                  <Column
                    key={status}
                    status={status}
                    videos={byStatus[status]}
                    onOpen={setDrawer}
                    onAdd={status === "idea" ? addVideo : undefined}
                    onQuickAdd={status === "dump" ? quickAdd : undefined}
                    dragId={dragId}
                    onDragStart={setDragId}
                    onDragEnd={() => setDragId(null)}
                    onDrop={(id, index) => moveVideo(id, status, index)}
                    onStatusChange={(id, next) => moveVideo(id, next)}
                  />
                ))}
              </Box>

              {/* Проверка тем реальной выдачей: план перестаёт быть списком идей и
                  становится набором решений с доказательством (см. topic-evidence.ts). */}
              <TopicEvidencePanel
                topics={(plan.videos ?? [])
                  .filter((v) => v.kind !== "short" && v.status !== "dump")
                  .map((v) => v.titles?.[0] ?? "")
                  .filter(Boolean)}
              />

              {/* Опорные блоки: портреты ЦА, лестница Ханта, возражения, выгоды,
                  причины, воронка. ⚠️ Шортсов тут больше НЕТ — их сборка стоит на
                  самой доске, рядом с переключателем типа. */}
              <SupportBlocks plan={plan} busy={blockBusy} onGenerate={generateBlock} />

              {byStatus.cancelled.length > 0 && (
                <Accordion variant="separated" radius="md">
                  <Accordion.Item value="cancelled">
                    <Accordion.Control>
                      <Group gap={8}>
                        <Text fw={600}>Отменённые</Text>
                        <Badge size="sm" variant="light" color="red" radius="sm">
                          {byStatus.cancelled.length}
                        </Badge>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap={0}>
                        {byStatus.cancelled.map((v) => (
                          <VideoCard
                            key={v.id}
                            v={v}
                            onOpen={() => setDrawer(v)}
                            draggable
                            onDragStart={() => setDragId(v.id)}
                            onDragEnd={() => setDragId(null)}
                            onStatus={(s) => moveVideo(v.id, s)}
                          />
                        ))}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              )}
            </>
          )}
        </>
      )}

      <VideoDrawer
        v={drawer}
        projectId={projectId}
        opened={drawer !== null}
        onClose={() => setDrawer(null)}
        onChange={(video) => {
          onVideoChange(video);
          setDrawer(video);
        }}
        onDelete={onVideoDelete}
      />

      {/* Импорт уже опубликованного ролика канала в план */}
      <LinkVideoModal
        projectId={projectId}
        opened={importOpen}
        onClose={() => setImportOpen(false)}
        onPick={importVideo}
      />
    </Stack>
  );
}

function Column({
  status,
  videos,
  onOpen,
  onAdd,
  onQuickAdd,
  dragId,
  onDragStart,
  onDragEnd,
  onDrop,
  onStatusChange,
}: {
  status: VideoStatus;
  videos: VideoView[];
  onOpen: (v: VideoView) => void;
  onAdd?: () => void;
  /** Быстрый ввод в свалку: текст или ссылка на ролик. */
  onQuickAdd?: (text: string) => Promise<void>;
  dragId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  /** id карточки + позиция вставки в этой колонке (0 = самый верх). */
  onDrop: (id: string, index: number) => void;
  onStatusChange: (id: string, status: VideoStatus) => void;
}) {
  const m = STATUS_META[status];
  const [over, setOver] = useState(false);
  const [quick, setQuick] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  // Куда встанет карточка, если отпустить сейчас: индекс между карточками.
  // null — курсор не над колонкой.
  const [at, setAt] = useState<number | null>(null);
  // Идёт перетаскивание — подсвечиваем ВСЕ колонки как возможные цели, а не только
  // ту, что под курсором. Иначе человек не понимает, что карточку вообще можно
  // куда-то тащить: подсказка появлялась ровно там, где он уже и так навёл.
  const dragging = Boolean(dragId);

  const finish = (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    const index = at ?? videos.length;
    setOver(false);
    setAt(null);
    if (id) onDrop(id, index);
  };

  return (
    <Box
      className={`cp-col${dragging ? " cp-col-target" : ""}${over ? " cp-col-over" : ""}`}
      onDragOver={(e) => {
        if (!dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
        // Курсор в пустой части колонки, ниже карточек — встаём в конец.
        if (at === null) setAt(videos.length);
      }}
      onDragLeave={(e) => {
        // Уходим из колонки, а не в дочерний элемент.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setOver(false);
          setAt(null);
        }
      }}
      onDrop={finish}
    >
      <Box className="cp-col-head">
        <span className="cp-col-dot" style={{ background: `var(--mantine-color-${m.color}-6)` }} />
        <Text fw={700}>{m.label}</Text>
        <Badge size="sm" variant="light" color={m.color} radius="sm">
          {videos.length}
        </Badge>
        {onAdd && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            ml="auto"
            leftSection={<IconPlus size={13} />}
            onClick={onAdd}
          >
            Ролик
          </Button>
        )}
      </Box>
      {/* Быстрый ввод — только у свалки. ⚠️ Одно поле без единой настройки: смысл
          свалки в том, чтобы записать мысль за две секунды и не думать. Как только
          тут появятся формат, тип и статус, ею перестанут пользоваться. */}
      {onQuickAdd && (
        <Group gap={6} wrap="nowrap" mb={8}>
          <TextInput
            size="xs"
            radius="md"
            placeholder="Мысль или ссылка на ролик"
            value={quick}
            onChange={(e) => setQuick(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !quick.trim() || quickBusy) return;
              e.preventDefault();
              setQuickBusy(true);
              void onQuickAdd(quick.trim()).finally(() => {
                setQuick("");
                setQuickBusy(false);
              });
            }}
            style={{ flex: 1 }}
            disabled={quickBusy}
          />
          <ActionIcon
            size="md"
            radius="md"
            variant="light"
            color="brand"
            aria-label="Кинуть в свалку"
            loading={quickBusy}
            disabled={!quick.trim()}
            onClick={() => {
              setQuickBusy(true);
              void onQuickAdd(quick.trim()).finally(() => {
                setQuick("");
                setQuickBusy(false);
              });
            }}
          >
            <IconPlus size={15} />
          </ActionIcon>
        </Group>
      )}
      {/* Тело колонки тянется до низа (см. .cp-col-body) — сбросить можно в любое
          место столбца, а не только туда, куда достаёт список карточек. */}
      <Box className="cp-col-body">
        {videos.length === 0 ? (
          <Box className="cp-col-empty">
            <Text size="xs" c="dimmed">
              {over
                ? "Отпусти — переедет сюда"
                : dragging
                  ? "Можно бросить сюда"
                  : status === "dump"
                    ? "Кидай сюда всё, что зацепило: мысль, тему, ссылку на чужой ролик. При сборке плана я это учту."
                    : "Пусто"}
            </Text>
          </Box>
        ) : (
          videos.map((v, i) => (
            <Box
              key={v.id}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                // Верхняя половина карточки — встать ПЕРЕД ней, нижняя — после.
                // Так порядок внутри колонки задаётся точно, а не «в конец».
                const r = e.currentTarget.getBoundingClientRect();
                const next = e.clientY < r.top + r.height / 2 ? i : i + 1;
                if (next !== at) setAt(next);
              }}
            >
              {/* Линия показывает, куда именно встанет карточка. */}
              {dragging && at === i && <Box className="cp-drop-line" />}
              <VideoCard
                v={v}
                onOpen={() => onOpen(v)}
                draggable
                onDragStart={() => onDragStart(v.id)}
                onDragEnd={onDragEnd}
                onStatus={(s) => onStatusChange(v.id, s)}
                // ⚠️ Индекс считается в списке БЕЗ этой карточки (её оттуда убирают перед
                // вставкой), поэтому «ниже» — это i + 1, а не i + 2.
                onMove={(dir) => onDrop(v.id, dir === "up" ? Math.max(0, i - 1) : i + 1)}
                canMoveUp={i > 0}
                canMoveDown={i < videos.length - 1}
              />
            </Box>
          ))
        )}
        {dragging && at === videos.length && videos.length > 0 && (
          <Box className="cp-drop-line" />
        )}
      </Box>
    </Box>
  );
}

function EmptyState({
  control,
  generating,
}: {
  control: React.ReactNode;
  generating: boolean;
}) {
  return (
    <Box className="an-surface" p="xl">
      <Center>
        <Stack gap="sm" align="center" maw={440} ta="center">
          <ThemeIcon size={56} radius="xl" variant="light" color="brand">
            <IconCalendarPlus size={28} />
          </ThemeIcon>
          <Text fw={700} fz="1.25rem">
            Соберём контент-план на месяц
          </Text>
          <Text size="sm" c="dimmed">
            По методике — {PLAN_VIDEO_COUNT} роликов: название и текст на превью по ВИСП, боль ЦА, 10
            вопросов-скелет, лестница Ханта и призывы. Дальше растащишь по статусам и привяжешь к
            своим роликам.
          </Text>
          {generating ? (
            <Group gap={8}>
              <Loader size="sm" color="brand" />
              <Text size="sm" c="dimmed">
                Собираю сетку…
              </Text>
            </Group>
          ) : (
            control
          )}
        </Stack>
      </Center>
    </Box>
  );
}

function metaOf(p: ContentPlanView): ContentPlanMeta {
  return {
    id: p.id,
    period: p.period,
    label: p.label,
    niche: p.niche,
    createdAt: p.createdAt,
    videoCount: p.videoCount,
    publishedCount: p.publishedCount,
  };
}
