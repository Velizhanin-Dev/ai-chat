"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  ScrollArea,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconPhoto,
  IconPhotoPlus,
  IconPin,
  IconPinFilled,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import {
  MAX_REFERENCES,
  MAX_REFERENCE_BYTES,
  REF_ROLE_LABEL,
  type RefRole,
  type ThumbnailRow,
} from "@/lib/thumbnails";
import {
  apiDeleteThumbnail,
  apiListThumbnails,
  findPendingThumbnailJob,
  awaitThumbnailJob,
  apiPinReference,
  apiUploadReference,
} from "@/lib/thumbnails-client";
import { apiGetProjectBrief } from "@/lib/chat-client";
import ThumbnailWizard from "./ThumbnailWizard";
import ThumbnailEditor from "./ThumbnailEditor";
import { forgetJob } from "@/lib/jobs-client";
import { JOB_LABELS } from "@/lib/jobs";

// Раздел «Генератор превью». Экран — галерея уже сделанных превью; создание идёт
// мастером (кнопка «Создать превью»), правка — в редакторе по клику на карточку.
// Прежняя анкета на 15 полей убрана: те же поля живут в мастере по шагам и в
// редакторе, но человек видит их порциями и с человеческими подписями.

// Группа = превью и все его перегенерации (вариации), свежие первыми.
interface Group {
  rootId: string;
  items: ThumbnailRow[];
}

function groupGenerations(rows: ThumbnailRow[]): Group[] {
  const byRoot = new Map<string, ThumbnailRow[]>();
  for (const r of rows) {
    const root = r.parentId ?? r.id;
    const list = byRoot.get(root);
    if (list) list.push(r);
    else byRoot.set(root, [r]);
  }
  return Array.from(byRoot.entries())
    .map(([rootId, items]) => ({
      rootId,
      items: [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }))
    .sort((a, b) => b.items[0].createdAt.localeCompare(a.items[0].createdAt));
}

export default function ThumbnailStudio({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<ThumbnailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [brief, setBrief] = useState<{ niche: string; audience: string }>({
    niche: "",
    audience: "",
  });
  const [uploading, setUploading] = useState(false);
  // Идёт фоновая генерация (своя или подхваченная после перезагрузки).
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadRole = useRef<RefRole>("style");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const rows = await apiListThumbnails(projectId);
        if (!cancelled) setItems(rows);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить превью");
      } finally {
        if (!cancelled) setLoading(false);
      }
      const b = await apiGetProjectBrief(projectId);
      if (!cancelled && b.ok) {
        setBrief({ niche: b.data.niche ?? "", audience: b.data.audience ?? "" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const references = useMemo(() => items.filter((i) => i.kind === "reference"), [items]);
  const groups = useMemo(
    () => groupGenerations(items.filter((i) => i.kind === "generation")),
    [items]
  );
  const openGroup = groups.find((g) => g.rootId === openGroupId) ?? null;

  const addItem = useCallback((row: ThumbnailRow) => setItems((prev) => [row, ...prev]), []);

  // Подхват незавершённой генерации. Человек мог обновить страницу, уйти на
  // другую вкладку раздела или вообще открыть проект с телефона — картинку в
  // это время рисует воркер, и результат надо показать, а не потерять.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const jobId = await findPendingThumbnailJob(projectId);
      if (!jobId || cancelled) return;
      setPending(true);
      try {
        const row = await awaitThumbnailJob(jobId);
        if (!cancelled) addItem(row);
      } catch (e) {
        // Задача упала, пока нас не было — показываем причину, а не молчим.
        if (!cancelled) setError(e instanceof Error ? e.message : "Генерация не удалась");
      } finally {
        if (!cancelled) setPending(false);
        forgetJob("thumbnail_generate", projectId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, addItem]);


  const remove = useCallback(
    async (id: string) => {
      const before = items;
      setItems((prev) => prev.filter((i) => i.id !== id));
      // Удалили последнюю версию открытой группы — закрываем редактор.
      const rest = before.filter((i) => i.id !== id && (i.parentId ?? i.id) === openGroupId);
      if (openGroupId && rest.length === 0) setOpenGroupId(null);
      try {
        await apiDeleteThumbnail(projectId, id);
      } catch (e) {
        setItems(before);
        setError(e instanceof Error ? e.message : "Не удалось удалить");
      }
    },
    [items, openGroupId, projectId]
  );

  const togglePin = useCallback(
    async (row: ThumbnailRow) => {
      const before = items;
      setItems((prev) => prev.map((i) => (i.id === row.id ? { ...i, pinned: !row.pinned } : i)));
      try {
        await apiPinReference(projectId, row.id, !row.pinned);
      } catch (e) {
        setItems(before);
        setError(e instanceof Error ? e.message : "Не удалось изменить референс");
      }
    },
    [items, projectId]
  );

  const upload = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setError(null);
      setUploading(true);
      try {
        const room = MAX_REFERENCES - references.length;
        for (const file of Array.from(files).slice(0, Math.max(0, room))) {
          if (file.size > MAX_REFERENCE_BYTES) {
            throw new Error(
              `«${file.name}» больше ${Math.round(MAX_REFERENCE_BYTES / 1024 / 1024)} МБ`
            );
          }
          addItem(await apiUploadReference(projectId, file, uploadRole.current));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить файл");
      } finally {
        setUploading(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    },
    [addItem, projectId, references.length]
  );

  return (
    <ScrollArea style={{ flex: 1, minHeight: 0 }}>
      <Box px={{ base: "sm", sm: "md" }} py="md" maw={1400} mx="auto">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => void upload(e.currentTarget.files)}
        />

        <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="sm">
          <Box>
            <Group gap="xs">
              <Title order={2} fz={{ base: "1.35rem", sm: "1.75rem" }}>
                Генератор превью
              </Title>
              <Badge color="brand" variant="light" radius="sm">
                бета
              </Badge>
            </Group>
            <Text c="dimmed" size="sm" mt={4}>
              Собираю превью по методике: одна идея, крупный спикер, текст в 3–5 слов. Лицо
              переношу с твоего фото один в один.
            </Text>
          </Box>
          <Button
            color="brand"
            size="md"
            leftSection={<IconSparkles size={18} />}
            onClick={() => setWizardOpen(true)}
          >
            Создать превью
          </Button>
        </Group>

        {error && (
          <Alert
            color="red"
            icon={<IconAlertCircle size={16} />}
            mb="md"
            withCloseButton
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}

        {/* Незавершённая генерация: подхвачена после возврата на страницу либо
            запущена прямо сейчас. Главное здесь — сказать, что можно уйти. */}
        {pending && (
          <Alert color="brand" icon={<IconSparkles size={16} />} mb="md">
            <Text fw={600} size="sm">
              {JOB_LABELS.thumbnail_generate.title}
            </Text>
            <Text size="xs" c="dimmed">
              {JOB_LABELS.thumbnail_generate.hint}
            </Text>
          </Alert>
        )}

        {/* ── Галерея ── */}
        {loading ? (
          <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="md">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} radius="lg" style={{ aspectRatio: "16 / 9" }} />
            ))}
          </SimpleGrid>
        ) : groups.length === 0 ? (
          <Box className="an-surface" p="xl">
            <Stack align="center" gap="sm">
              <ThemeIcon size={56} radius="xl" variant="light" color="brand">
                <IconPhoto size={28} />
              </ThemeIcon>
              <Text fw={600}>Превью ещё нет</Text>
              <Text size="sm" c="dimmed" ta="center" maw={460}>
                Задам три вопроса про ролик и нарисую обложку. Текст на превью подберу по
                методике — выберешь из вариантов.
              </Text>
              <Button
                color="brand"
                leftSection={<IconSparkles size={16} />}
                onClick={() => setWizardOpen(true)}
              >
                Создать превью
              </Button>
            </Stack>
          </Box>
        ) : (
          <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="md">
            {groups.map((g) => {
              const top = g.items[0];
              return (
                <UnstyledButton
                  key={g.rootId}
                  onClick={() => setOpenGroupId(g.rootId)}
                  className="yt-video-card"
                  style={{ borderRadius: 12 }}
                >
                  <Box
                    style={{
                      position: "relative",
                      aspectRatio: "16 / 9",
                      borderRadius: 12,
                      overflow: "hidden",
                      background: "var(--mantine-color-dark-4)",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={top.url}
                      alt={top.label || "превью"}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                    {g.items.length > 1 && (
                      <Badge
                        size="sm"
                        variant="filled"
                        color="dark"
                        style={{ position: "absolute", top: 6, right: 6 }}
                      >
                        {g.items.length}
                      </Badge>
                    )}
                  </Box>
                  {top.label && (
                    <Text size="sm" mt={6} lineClamp={1}>
                      {top.label}
                    </Text>
                  )}
                </UnstyledButton>
              );
            })}
          </SimpleGrid>
        )}

        {/* ── Референсы проекта ── */}
        <Box mt="xl">
          <Group justify="space-between" align="flex-start" mb="xs" wrap="nowrap">
            <Box>
              <Text fw={600}>Фото и стили проекта</Text>
              <Text size="xs" c="dimmed">
                Фото спикера — чтобы на превью было его лицо. Стиль — картинка-образец: закрепи
                её, и все новые превью будут в одном виде.
              </Text>
            </Box>
            <Group gap="xs" wrap="nowrap">
              <Button
                size="xs"
                variant="light"
                color="brand"
                leftSection={<IconPhotoPlus size={14} />}
                loading={uploading}
                disabled={references.length >= MAX_REFERENCES}
                onClick={() => {
                  uploadRole.current = "speaker";
                  fileInput.current?.click();
                }}
              >
                Фото спикера
              </Button>
              <Button
                size="xs"
                variant="light"
                color="gray"
                leftSection={<IconPhotoPlus size={14} />}
                loading={uploading}
                disabled={references.length >= MAX_REFERENCES}
                onClick={() => {
                  uploadRole.current = "style";
                  fileInput.current?.click();
                }}
              >
                Стиль
              </Button>
            </Group>
          </Group>

          {references.length === 0 ? (
            <Text size="sm" c="dimmed">
              Пока пусто. Без фото спикера нарисую человека с нуля — на тебя он похож не будет.
            </Text>
          ) : (
            <SimpleGrid cols={{ base: 3, sm: 5, lg: 6 }} spacing="sm">
              {references.map((r) => (
                <Box key={r.id}>
                  <Box
                    style={{
                      position: "relative",
                      aspectRatio: "16 / 9",
                      borderRadius: 10,
                      overflow: "hidden",
                      border: "1px solid var(--mantine-color-default-border)",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.url}
                      alt={r.label || REF_ROLE_LABEL[r.role]}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                    <Group gap={4} style={{ position: "absolute", top: 4, right: 4 }} wrap="nowrap">
                      {r.role === "style" && (
                        <Tooltip
                          label={
                            r.pinned ? "Применяется ко всем превью" : "Применять ко всем превью"
                          }
                          withArrow
                        >
                          <ThemeIcon
                            size="sm"
                            radius="xl"
                            variant="filled"
                            color={r.pinned ? "brand" : "dark"}
                            style={{ cursor: "pointer" }}
                            onClick={() => void togglePin(r)}
                            role="button"
                            aria-label={r.pinned ? "Открепить стиль" : "Закрепить стиль"}
                          >
                            {r.pinned ? <IconPinFilled size={12} /> : <IconPin size={12} />}
                          </ThemeIcon>
                        </Tooltip>
                      )}
                      <ThemeIcon
                        size="sm"
                        radius="xl"
                        variant="filled"
                        color="dark"
                        style={{ cursor: "pointer" }}
                        onClick={() => void remove(r.id)}
                        role="button"
                        aria-label="Удалить референс"
                      >
                        <IconTrash size={12} />
                      </ThemeIcon>
                    </Group>
                  </Box>
                  <Text size="xs" c="dimmed" mt={4}>
                    {REF_ROLE_LABEL[r.role]}
                  </Text>
                </Box>
              ))}
            </SimpleGrid>
          )}
        </Box>
      </Box>

      <ThumbnailWizard
        projectId={projectId}
        opened={wizardOpen}
        onClose={() => setWizardOpen(false)}
        references={references}
        onReferenceAdded={addItem}
        niche={brief.niche}
        audience={brief.audience}
        onCreated={(row) => {
          addItem(row);
          setWizardOpen(false);
          // Сразу открываем редактор новой картинки — как и просили.
          setOpenGroupId(row.parentId ?? row.id);
        }}
      />

      <ThumbnailEditor
        projectId={projectId}
        opened={Boolean(openGroup)}
        variants={openGroup?.items ?? []}
        onClose={() => setOpenGroupId(null)}
        references={references}
        onCreated={addItem}
        onDelete={(id) => void remove(id)}
      />
    </ScrollArea>
  );
}
