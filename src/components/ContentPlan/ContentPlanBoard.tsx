"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Accordion,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Select,
  Skeleton,
  Stack,
  Text,
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
  apiResyncPlan,
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
import LinkVideoModal from "./LinkVideoModal";
import SupportBlocks from "./SupportBlocks";
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
    const res = await apiAddVideo(activeId);
    if (res.ok) {
      setPlan((prev) => (prev ? { ...prev, videos: [...prev.videos, res.data.video] } : prev));
      setDrawer(res.data.video);
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

  const onVideoChange = (video: VideoView) =>
    setPlan((prev) =>
      prev ? { ...prev, videos: prev.videos.map((v) => (v.id === video.id ? video : v)) } : prev
    );
  const onVideoDelete = (id: string) =>
    setPlan((prev) => (prev ? { ...prev, videos: prev.videos.filter((v) => v.id !== id) } : prev));

  // DnD: бросили карточку в колонку статуса → оптимистично двигаем + PATCH.
  const moveVideo = async (id: string, status: VideoStatus) => {
    setDragId(null);
    const current = plan?.videos.find((v) => v.id === id);
    if (!current || current.status === status) return;
    onVideoChange({ ...current, status });
    const res = await apiUpdateVideo(id, { status });
    if (res.ok) onVideoChange(res.data.video);
    else {
      onVideoChange(current); // откат
      setError("Не удалось перенести ролик");
    }
  };

  // Канбан — только лонги; шортсы живут отдельной сеткой в опорных блоках
  // (у них своя природа: верх воронки, нарезки/реакции, лёгкие поля).
  const byStatus = useMemo(() => {
    const map: Record<VideoStatus, VideoView[]> = {
      idea: [],
      in_progress: [],
      published: [],
      cancelled: [],
    };
    for (const v of plan?.videos ?? []) if (v.kind !== "short") map[v.status].push(v);
    return map;
  }, [plan]);

  const shorts = useMemo(
    () => (plan?.videos ?? []).filter((v) => v.kind === "short"),
    [plan]
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
              <Box className="cp-board">
                {BOARD_COLUMNS.map((status) => (
                  <Column
                    key={status}
                    status={status}
                    videos={byStatus[status]}
                    onOpen={setDrawer}
                    onAdd={status === "idea" ? addVideo : undefined}
                    dragId={dragId}
                    onDragStart={setDragId}
                    onDragEnd={() => setDragId(null)}
                    onDrop={(id) => moveVideo(id, status)}
                  />
                ))}
              </Box>

              {/* Опорные блоки: портреты ЦА, лестница Ханта, воронка, шортсы */}
              <SupportBlocks
                plan={plan}
                shorts={shorts}
                busy={blockBusy}
                onGenerate={generateBlock}
                onOpenShort={setDrawer}
              />

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
                          <VideoCard key={v.id} v={v} onOpen={() => setDrawer(v)} />
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
  dragId,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  status: VideoStatus;
  videos: VideoView[];
  onOpen: (v: VideoView) => void;
  onAdd?: () => void;
  dragId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (id: string) => void;
}) {
  const m = STATUS_META[status];
  const [over, setOver] = useState(false);
  // Идёт перетаскивание — подсвечиваем ВСЕ колонки как возможные цели, а не только
  // ту, что под курсором. Иначе человек не понимает, что карточку вообще можно
  // куда-то тащить: подсказка появлялась ровно там, где он уже и так навёл.
  const dragging = Boolean(dragId);
  return (
    <Box
      className={`cp-col${dragging ? " cp-col-target" : ""}${over ? " cp-col-over" : ""}`}
      onDragOver={(e) => {
        if (dragId) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (!over) setOver(true);
        }
      }}
      onDragLeave={(e) => {
        // Уходим из колонки, а не в дочерний элемент.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain") || dragId;
        if (id) onDrop(id);
      }}
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
      {videos.length === 0 ? (
        <Box className="cp-col-empty">
          <Text size="xs" c="dimmed">
            {over ? "Отпусти — переедет сюда" : dragging ? "Можно бросить сюда" : "Пусто"}
          </Text>
        </Box>
      ) : (
        <Box>
          {videos.map((v) => (
            <VideoCard
              key={v.id}
              v={v}
              onOpen={() => onOpen(v)}
              draggable
              onDragStart={() => onDragStart(v.id)}
              onDragEnd={onDragEnd}
            />
          ))}
        </Box>
      )}
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
