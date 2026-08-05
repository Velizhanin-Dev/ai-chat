"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconCheck,
  IconPhotoPlus,
  IconSparkles,
  IconUpload,
} from "@tabler/icons-react";
import {
  AUDIENCE_PRESETS,
  EMPTY_SPEC,
  MAX_REFERENCE_BYTES,
  SPEC_LIMITS,
  THUMBNAIL_GENERATE_QUOTA_COST,
  type RefRole,
  type ThumbnailIdeas,
  type ThumbnailRow,
  type ThumbnailSpec,
} from "@/lib/thumbnails";
import {
  apiGenerateThumbnail,
  apiThumbnailIdeas,
  apiUploadReference,
} from "@/lib/thumbnails-client";
import { useAppDispatch } from "@/store/hooks";
import { bumpRequestsUsed } from "@/store/authSlice";

// Мастер создания превью: три коротких шага вместо анкеты на 15 полей.
// 1. О чём ролик  2. Кто в кадре  3. Как выглядит (текст и стиль подсказывает
// нейронка по методике). Черновик пишется в localStorage — недозаполненный мастер
// переживает перезагрузку. После генерации родитель открывает редактор.

const STEPS = ["О чём ролик", "Кто в кадре", "Как выглядит"];
const DRAFT_KEY = "creative-chat:thumb-draft-v1";

interface Draft {
  spec: ThumbnailSpec;
  step: number;
  speakerIds: string[];
  styleIds: string[];
}

function draftKey(projectId: string): string {
  return `${DRAFT_KEY}:${projectId}`;
}
function loadDraft(projectId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(projectId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d?.spec ? d : null;
  } catch {
    return null;
  }
}

interface Props {
  projectId: string;
  opened: boolean;
  onClose: () => void;
  // Референсы проекта (спикеры/объекты/стили) + колбэк, когда загрузили новый.
  references: ThumbnailRow[];
  onReferenceAdded: (row: ThumbnailRow) => void;
  // Готовое превью — родитель кладёт в галерею и открывает редактор.
  onCreated: (row: ThumbnailRow) => void;
  // Ниша и аудитория из брифа проекта — показываем строкой, чтобы не спрашивать.
  niche: string;
  audience: string;
}

export default function ThumbnailWizard({
  projectId,
  opened,
  onClose,
  references,
  onReferenceAdded,
  onCreated,
  niche,
  audience,
}: Props) {
  const dispatch = useAppDispatch();
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [step, setStep] = useState(0);
  const [spec, setSpec] = useState<ThumbnailSpec>({ ...EMPTY_SPEC, niche, audience });
  const [speakerIds, setSpeakerIds] = useState<string[]>([]);
  const [styleIds, setStyleIds] = useState<string[]>([]);
  const [ideas, setIdeas] = useState<ThumbnailIdeas | null>(null);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadRole = useRef<RefRole>("speaker");

  const set = <K extends keyof ThumbnailSpec>(key: K, value: ThumbnailSpec[K]) =>
    setSpec((s) => ({ ...s, [key]: value }));

  // Восстановление черновика на открытии; закреплённые стили подставляем сразу.
  useEffect(() => {
    if (!opened) return;
    const d = loadDraft(projectId);
    if (d) {
      setSpec({ ...d.spec, niche: d.spec.niche || niche, audience: d.spec.audience || audience });
      setStep(Math.min(d.step, STEPS.length - 1));
      setSpeakerIds(d.speakerIds ?? []);
      setStyleIds(d.styleIds ?? []);
    } else {
      setSpec({ ...EMPTY_SPEC, niche, audience });
      setStep(0);
      setSpeakerIds([]);
      setStyleIds(references.filter((r) => r.role === "style" && r.pinned).map((r) => r.id));
    }
    setIdeas(null);
    setError(null);
    // references в зависимостях не нужны: закреплённые стили берём один раз на открытии.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, projectId, niche, audience]);

  // Пишем черновик на каждое изменение — мастер переживает перезагрузку.
  useEffect(() => {
    if (!opened) return;
    try {
      localStorage.setItem(
        draftKey(projectId),
        JSON.stringify({ spec, step, speakerIds, styleIds } satisfies Draft)
      );
    } catch {
      // приватный режим / переполнение — не критично
    }
  }, [opened, projectId, spec, step, speakerIds, styleIds]);

  const upload = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setError(null);
      setBusy(true);
      try {
        for (const file of Array.from(files).slice(0, 3)) {
          if (file.size > MAX_REFERENCE_BYTES) {
            throw new Error(
              `«${file.name}» больше ${Math.round(MAX_REFERENCE_BYTES / 1024 / 1024)} МБ`
            );
          }
          const row = await apiUploadReference(projectId, file, uploadRole.current);
          onReferenceAdded(row);
          if (uploadRole.current === "style") setStyleIds((p) => [...p, row.id]);
          else setSpeakerIds((p) => [...p, row.id]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить фото");
      } finally {
        setBusy(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    },
    [projectId, onReferenceAdded]
  );

  const pickFiles = (role: RefRole) => {
    uploadRole.current = role;
    fileInput.current?.click();
  };

  // Подсказки по методике — тянем при входе на третий шаг (тратит 1 запрос).
  const askIdeas = useCallback(async () => {
    setIdeasLoading(true);
    setError(null);
    try {
      const res = await apiThumbnailIdeas(projectId, spec);
      setIdeas(res);
      // Пустые поля заполняем предложенным, введённое руками не трогаем.
      setSpec((s) => ({
        ...s,
        supportObject: s.supportObject || res.supportObject,
        emotion: s.emotion || res.emotion,
        palette: s.palette || res.palette,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подобрать варианты");
    } finally {
      setIdeasLoading(false);
    }
  }, [projectId, spec]);

  const goNext = () => {
    const next = step + 1;
    setStep(next);
    if (next === 2 && !ideas && !ideasLoading) void askIdeas();
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      // Порядок референсов = Image 1..N в промпте: спикер первым, стиль следом.
      const refIds = [...speakerIds, ...styleIds];
      const row = await apiGenerateThumbnail(projectId, spec, refIds);
      dispatch(bumpRequestsUsed(THUMBNAIL_GENERATE_QUOTA_COST)); // остаток квоты в шапке не отстаёт
      try {
        localStorage.removeItem(draftKey(projectId));
      } catch {
        // не критично
      }
      onCreated(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сгенерировать превью");
    } finally {
      setBusy(false);
    }
  };

  const speakers = references.filter((r) => r.role === "speaker" || r.role === "object");
  const styles = references.filter((r) => r.role === "style");
  const canNext = step === 0 ? Boolean(spec.videoSummary.trim() || spec.videoTitle.trim()) : true;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <ThemeIcon variant="light" color="brand" radius="md">
            <IconSparkles size={18} />
          </ThemeIcon>
          <Text fw={600}>Новое превью</Text>
        </Group>
      }
      size="lg"
      radius="lg"
      fullScreen={isMobile}
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => void upload(e.currentTarget.files)}
      />

      <Stack gap="md">
        {/* Прогресс: где я и сколько осталось */}
        <Box>
          <Group justify="space-between" mb={6}>
            <Text size="sm" fw={600}>
              {STEPS[step]}
            </Text>
            <Text size="xs" c="dimmed">
              шаг {step + 1} из {STEPS.length}
            </Text>
          </Group>
          <Progress value={((step + 1) / STEPS.length) * 100} color="brand" size="sm" radius="xl" />
        </Box>

        {error && (
          <Alert
            color="red"
            icon={<IconAlertCircle size={16} />}
            withCloseButton
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}

        {/* ── Шаг 1: о чём ролик ── */}
        {step === 0 && (
          <Stack gap="sm">
            <Textarea
              label="О чём ролик"
              description="Пары предложений хватит — остальное подскажу сам."
              placeholder="Например: разбираю, почему ремонт под ключ выходит дороже сметы"
              autosize
              minRows={3}
              maxRows={7}
              maxLength={SPEC_LIMITS.videoSummary}
              value={spec.videoSummary}
              onChange={(e) => set("videoSummary", e.currentTarget.value)}
              data-autofocus
            />
            <TextInput
              label="Название ролика"
              description="Необязательно. Нужно, чтобы текст на превью его не повторял."
              maxLength={SPEC_LIMITS.videoTitle}
              value={spec.videoTitle}
              onChange={(e) => set("videoTitle", e.currentTarget.value)}
            />
            {(spec.niche || spec.audience) && (
              <Text size="xs" c="dimmed">
                Из брифа проекта: {spec.niche || "ниша не указана"}
                {spec.audience ? ` · ${spec.audience}` : ""}
              </Text>
            )}
          </Stack>
        )}

        {/* ── Шаг 2: кто в кадре ── */}
        {step === 1 && (
          <Stack gap="sm">
            <Box>
              <Text size="sm" fw={500} mb={4}>
                Сколько людей на превью
              </Text>
              <SegmentedControl
                color="brand"
                value={String(spec.peopleCount)}
                onChange={(v) => set("peopleCount", Number(v))}
                data={[
                  { value: "0", label: "Без людей" },
                  { value: "1", label: "Один" },
                  { value: "2", label: "Двое" },
                ]}
              />
            </Box>

            {spec.peopleCount > 0 && (
              <Box>
                <Group justify="space-between" mb={6} wrap="nowrap">
                  <Text size="sm" fw={500}>
                    Фото спикера
                  </Text>
                  <Button
                    size="xs"
                    variant="light"
                    color="brand"
                    leftSection={<IconUpload size={14} />}
                    onClick={() => pickFiles("speaker")}
                    loading={busy}
                  >
                    Загрузить
                  </Button>
                </Group>
                <Text size="xs" c="dimmed" mb="xs">
                  Лицо переношу один в один, без «улучшений». Чем чётче фото — тем лучше
                  результат. Загруженные фото остаются в проекте.
                </Text>
                {speakers.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    Пока нет фото. Без него нарисую человека с нуля — на настоящего спикера он
                    похож не будет.
                  </Text>
                ) : (
                  <RefPicker
                    rows={speakers}
                    selected={speakerIds}
                    onToggle={(id) =>
                      setSpeakerIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
                    }
                  />
                )}
              </Box>
            )}
          </Stack>
        )}

        {/* ── Шаг 3: как выглядит ── */}
        {step === 2 && (
          <Stack gap="md">
            {ideasLoading && (
              <Group gap="xs">
                <Loader size="xs" color="brand" />
                <Text size="sm" c="dimmed">
                  Подбираю варианты текста по методике…
                </Text>
              </Group>
            )}

            {ideas && ideas.thumbTexts.length > 0 && (
              <Box>
                <Text size="sm" fw={500} mb={6}>
                  Текст на превью — выбери или напиши свой
                </Text>
                <Stack gap={6}>
                  {ideas.thumbTexts.map((t) => {
                    const active = spec.thumbText === t.text;
                    return (
                      <UnstyledButton
                        key={t.text}
                        onClick={() => {
                          set("thumbText", t.text);
                          set("keyWord", t.keyWord);
                        }}
                      >
                        <Paper
                          radius="md"
                          p="sm"
                          className="an-surface"
                          style={{
                            outline: active
                              ? "2px solid var(--mantine-color-brand-6)"
                              : "2px solid transparent",
                          }}
                        >
                          <Group justify="space-between" wrap="nowrap" gap="xs">
                            <Text fw={600} size="sm">
                              {t.text}
                            </Text>
                            {active && (
                              <ThemeIcon size="sm" radius="xl" color="brand" variant="filled">
                                <IconCheck size={12} />
                              </ThemeIcon>
                            )}
                          </Group>
                          <Text size="xs" c="dimmed" mt={2}>
                            {t.why}
                          </Text>
                        </Paper>
                      </UnstyledButton>
                    );
                  })}
                </Stack>
              </Box>
            )}

            <TextInput
              label="Текст на превью"
              description="Не больше пяти слов. Пусто — нарисую превью без текста."
              maxLength={SPEC_LIMITS.thumbText}
              value={spec.thumbText}
              onChange={(e) => set("thumbText", e.currentTarget.value)}
            />

            <Group grow align="flex-start">
              <TextInput
                label="Эмоция"
                maxLength={SPEC_LIMITS.emotion}
                value={spec.emotion}
                onChange={(e) => set("emotion", e.currentTarget.value)}
              />
              <TextInput
                label="Что ещё в кадре"
                maxLength={SPEC_LIMITS.supportObject}
                value={spec.supportObject}
                onChange={(e) => set("supportObject", e.currentTarget.value)}
              />
            </Group>

            <Box>
              <Group justify="space-between" mb={6} wrap="nowrap">
                <Box>
                  <Text size="sm" fw={500}>
                    Стиль превью
                  </Text>
                  <Text size="xs" c="dimmed">
                    Подложи картинку, на которую хочешь быть похожим, — так все превью канала
                    будут в одном виде.
                  </Text>
                </Box>
                <Button
                  size="xs"
                  variant="light"
                  color="brand"
                  leftSection={<IconPhotoPlus size={14} />}
                  onClick={() => pickFiles("style")}
                  loading={busy}
                >
                  Добавить
                </Button>
              </Group>
              {styles.length > 0 && (
                <RefPicker
                  rows={styles}
                  selected={styleIds}
                  onToggle={(id) =>
                    setStyleIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
                  }
                />
              )}
            </Box>

            <Box>
              <Text size="sm" fw={500} mb={6}>
                Под кого превью
              </Text>
              <SegmentedControl
                color="brand"
                fullWidth
                size="xs"
                value={spec.audiencePreset}
                onChange={(v) => set("audiencePreset", v)}
                data={AUDIENCE_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
              />
              <Text size="xs" c="dimmed" mt={4}>
                {AUDIENCE_PRESETS.find((p) => p.id === spec.audiencePreset)?.hint ?? ""}
              </Text>
            </Box>
          </Stack>
        )}

        {/* Навигация */}
        <Group justify="space-between" mt="xs">
          <Button
            variant="subtle"
            color="gray"
            onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
            disabled={busy}
          >
            {step === 0 ? "Отмена" : "Назад"}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button color="brand" onClick={goNext} disabled={!canNext || busy}>
              Дальше
            </Button>
          ) : (
            <Button
              color="brand"
              leftSection={<IconSparkles size={16} />}
              onClick={create}
              loading={busy}
            >
              Создать превью
            </Button>
          )}
        </Group>
        {step === STEPS.length - 1 && (
          <Text size="xs" c="dimmed" ta="center">
            Одна картинка — 1 запрос из тарифа. Рисуется до минуты.
          </Text>
        )}
      </Stack>
    </Modal>
  );
}

// Выбор референсов плитками: клик — включить/выключить участие в генерации.
function RefPicker({
  rows,
  selected,
  onToggle,
}: {
  rows: ThumbnailRow[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs">
      {rows.map((r) => {
        const active = selected.includes(r.id);
        return (
          <UnstyledButton key={r.id} onClick={() => onToggle(r.id)} aria-pressed={active}>
            <Box
              style={{
                position: "relative",
                aspectRatio: "16 / 9",
                borderRadius: 10,
                overflow: "hidden",
                outline: active
                  ? "2px solid var(--mantine-color-brand-6)"
                  : "1px solid var(--mantine-color-default-border)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={r.url}
                alt={r.label || "референс"}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
              {active && (
                <ThemeIcon
                  size="sm"
                  radius="xl"
                  color="brand"
                  variant="filled"
                  style={{ position: "absolute", top: 4, right: 4 }}
                >
                  <IconCheck size={12} />
                </ThemeIcon>
              )}
              {r.pinned && (
                <Badge
                  size="xs"
                  variant="filled"
                  color="brand"
                  style={{ position: "absolute", bottom: 4, left: 4 }}
                >
                  всегда
                </Badge>
              )}
            </Box>
          </UnstyledButton>
        );
      })}
    </SimpleGrid>
  );
}
