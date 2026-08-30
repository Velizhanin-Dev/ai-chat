"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Spoiler,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  UnstyledButton,
  Select,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { apiContentPlan, apiContentPlans } from "@/lib/content-plan-client";
import {
  IconAlertCircle,
  IconInfoCircle,
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
  THUMB_STYLES,
  buildThumbnailPrompt,
  normalizeRefRole,
  speakerNeedFor,
  thumbStyleById,
  type PromptRef,
  type RefRole,
  type ThumbnailIdeas,
  type ThumbnailRow,
  type ThumbnailSpec,
  THUMBNAIL_SPEC_QUOTA_COST,
} from "@/lib/thumbnails";
import {
  apiGenerateThumbnail,
  apiThumbnailIdeas,
  apiUploadReference,
} from "@/lib/thumbnails-client";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useProjectPlatform } from "@/hooks/useProjectPlatform";
import { bumpRequestsUsed } from "@/store/authSlice";

// Мастер создания превью. Флоу задан владельцем (2026-08-07):
//   ЦА → стиль (5 вариантов) → кто в кадре → о чём ролик → текст и название от ИИ
//   → сводка с промптом → генерация.
// Шаг «кто в кадре» пропускается, если выбранный стиль спикера не требует
// (например рекламно-каталожный подстиль спецпроектов).
// Черновик пишется в localStorage — недозаполненный мастер переживает перезагрузку.

const DRAFT_KEY = "creative-chat:thumb-draft-v2";

type StepId = "audience" | "style" | "frame" | "topic" | "text" | "review";

const STEP_TITLE: Record<StepId, string> = {
  audience: "Кому показываем",
  style: "Как выглядит",
  frame: "Кто в кадре",
  topic: "О чём ролик",
  text: "Текст и название",
  review: "Проверь и запускай",
};

interface Draft {
  spec: ThumbnailSpec;
  stepId: StepId;
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
  references: ThumbnailRow[];
  onReferenceAdded: (row: ThumbnailRow) => void;
  onCreated: (row: ThumbnailRow) => void;
  niche: string;
  audience: string;
}

// Роль нужна только чтобы показать админу служебное ТЗ для image-модели.
// Карточка контент-плана в пикере шага «Текст и название».
interface PlanCard {
  id: string;
  title: string;
  previewText: string;
  kind: string;
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
  // ТЗ для image-модели показываем только админам (см. блок в шаге сводки).
  const isAdmin = useAppSelector((st) => st.auth.user?.role === "admin");
  // Площадка проекта: от неё зависит формат кадра и правила композиции в промпте.
  const { platform } = useProjectPlatform();
  const dispatch = useAppDispatch();
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [stepId, setStepId] = useState<StepId>("audience");
  const [spec, setSpec] = useState<ThumbnailSpec>({ ...EMPTY_SPEC, niche, audience });
  const [speakerIds, setSpeakerIds] = useState<string[]>([]);
  const [styleIds, setStyleIds] = useState<string[]>([]);
  const [ideas, setIdeas] = useState<ThumbnailIdeas | null>(null);
  const [ideasLoading, setIdeasLoading] = useState(false);
  // Карточки контент-плана: у каждой уже есть название И текст на превью по
  // методике — готовая упаковка, за которую уже «заплачено» при сборке плана.
  // null — ещё не загружали. Бесплатно: обычное чтение из БД.
  const [planCards, setPlanCards] = useState<PlanCard[] | null>(null);
  const [pickedCard, setPickedCard] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadRole = useRef<RefRole>("speaker");

  const set = <K extends keyof ThumbnailSpec>(key: K, value: ThumbnailSpec[K]) =>
    setSpec((s) => ({ ...s, [key]: value }));

  const style = thumbStyleById(spec.style);
  const speakerNeed = speakerNeedFor(spec.style, spec.subStyle);

  // Шаг «кто в кадре» показываем, только если стиль допускает человека в кадре.
  const steps: StepId[] = useMemo(
    () =>
      (
        ["audience", "style", "frame", "topic", "text", "review"] as StepId[]
      ).filter((s) => s !== "frame" || speakerNeed !== "none"),
    [speakerNeed]
  );
  const stepIndex = Math.max(0, steps.indexOf(stepId));

  // Восстановление черновика на открытии; закреплённые стили подставляем сразу.
  useEffect(() => {
    if (!opened) return;
    const d = loadDraft(projectId);
    if (d) {
      setSpec({ ...d.spec, niche: d.spec.niche || niche, audience: d.spec.audience || audience });
      setStepId(d.stepId ?? "audience");
      setSpeakerIds(d.speakerIds ?? []);
      setStyleIds(d.styleIds ?? []);
    } else {
      setSpec({ ...EMPTY_SPEC, niche, audience });
      setStepId("audience");
      setSpeakerIds([]);
      setStyleIds(references.filter((r) => r.role === "style" && r.pinned).map((r) => r.id));
    }
    setIdeas(null);
    setError(null);
    // references в зависимостях не нужны: закреплённые стили берём один раз на открытии.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, projectId, niche, audience]);

  useEffect(() => {
    if (!opened) return;
    try {
      localStorage.setItem(
        draftKey(projectId),
        JSON.stringify({ spec, stepId, speakerIds, styleIds } satisfies Draft)
      );
    } catch {
      // приватный режим / переполнение — не критично
    }
  }, [opened, projectId, spec, stepId, speakerIds, styleIds]);

  // Стиль без людей — сразу обнуляем счётчик и снимаем выбранные фото спикера,
  // иначе в промпт уедет «максимум 1 человек» вместе с «людей в кадре нет».
  useEffect(() => {
    if (speakerNeed === "none" && spec.peopleCount !== 0) {
      set("peopleCount", 0);
      setSpeakerIds([]);
      // ⚠️ Эмоцию тоже чистим: это поле про ПОЗУ И ЛИЦО спикера. В промпт при
      // people=0 она и так не уходит (гейт в buildThumbnailPrompt), но в сводке
      // строка «Эмоция: руки скрещены, взгляд исподлобья» рядом с «В кадре: без
      // людей» читалась как противоречие — ловили на проде.
      set("emotion", "");
    }
    if (speakerNeed !== "none" && spec.peopleCount === 0) set("peopleCount", 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakerNeed]);

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

  // Названия и текст на превью по методике — тянем при входе на шаг «Текст и название».
  const askIdeas = useCallback(async () => {
    setIdeasLoading(true);
    setError(null);
    try {
      const res = await apiThumbnailIdeas(projectId, spec);
      setIdeas(res);
      setSpec((s) => ({
        ...s,
        supportObject: s.supportObject || res.supportObject,
        // Эмоция — про лицо и позу спикера: при «без людей» её некому носить.
        emotion: s.peopleCount === 0 ? s.emotion : s.emotion || res.emotion,
        palette: s.palette || res.palette,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подобрать варианты");
    } finally {
      setIdeasLoading(false);
    }
  }, [projectId, spec]);

  // ⚠️ Выбрал стиль-референсы → по умолчанию «повторить 1 в 1» (балл 5).
  // Раньше дефолт был «1» (референс — только контекст, НЕ копируй), причём ручки
  // в UI не было вовсе: человек закреплял шесть обложек канала и получал
  // «рандомный» дизайн, потому что модель ЧЕСТНО выполняла запрет копирования.
  useEffect(() => {
    if (styleIds.length > 0 && spec.refScore === "1") set("refScore", "5");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleIds.length]);

  // Карточки свежего плана проекта (лонги и шортсы, без свалки и отменённых).
  const loadPlanCards = useCallback(async () => {
    try {
      const metas = await apiContentPlans(projectId);
      if (!metas.ok || metas.data.plans.length === 0) {
        setPlanCards([]);
        return;
      }
      const plan = await apiContentPlan(metas.data.plans[0].id);
      if (!plan.ok) {
        setPlanCards([]);
        return;
      }
      const cards: PlanCard[] = plan.data.plan.videos
        .filter((v) => v.status !== "dump" && v.status !== "cancelled" && v.titles[0])
        .map((v) => ({
          id: v.id,
          title: v.titles[0],
          previewText: v.previewTexts[0] ?? "",
          kind: v.kind,
        }));
      setPlanCards(cards);
    } catch {
      setPlanCards([]);
    }
  }, [projectId]);

  const goNext = () => {
    const next = steps[stepIndex + 1];
    if (!next) return;
    setStepId(next);
    // ⚠️ Подсказку от ИИ на входе в шаг БОЛЬШЕ НЕ запускаем автоматически: она
    // стоит 1 запрос квоты на каждый вход и десяток секунд ожидания, а у
    // большинства уже есть контент-план с готовыми названиями и текстами на
    // превью. Теперь сначала выбор из плана (бесплатно, мгновенно), а подсказка
    // — по явной кнопке.
    if (next === "text" && planCards === null) void loadPlanCards();
  };
  const goBack = () => {
    const prev = steps[stepIndex - 1];
    if (prev) setStepId(prev);
    else onClose();
  };

  // Порядок референсов = Image 1..N в промпте: спикер первым, стиль следом.
  const refIds = useMemo(() => [...speakerIds, ...styleIds], [speakerIds, styleIds]);
  // Тот же промпт, что соберёт сервер: человек видит ровно то, что уйдёт в модель.
  const previewPrompt = useMemo(() => {
    const ordered: PromptRef[] = refIds
      .map((id) => references.find((r) => r.id === id))
      .filter((r): r is ThumbnailRow => Boolean(r))
      .map((r) => ({ role: normalizeRefRole(r.role), label: r.label }));
    return buildThumbnailPrompt(spec, ordered, platform);
  }, [spec, refIds, references, platform]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const row = await apiGenerateThumbnail(projectId, spec, refIds);
      dispatch(bumpRequestsUsed(THUMBNAIL_GENERATE_QUOTA_COST));
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
  const styleRefs = references.filter((r) => r.role === "style");

  const canNext =
    stepId === "style"
      ? Boolean(!style.subStyles?.length || spec.subStyle)
      : stepId === "topic"
        ? Boolean(spec.videoSummary.trim() || spec.instructions.trim())
        : true;

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
        <Box>
          <Group justify="space-between" mb={6}>
            <Text size="sm" fw={600}>
              {STEP_TITLE[stepId]}
            </Text>
            <Text size="xs" c="dimmed">
              шаг {stepIndex + 1} из {steps.length}
            </Text>
          </Group>
          <Progress
            value={((stepIndex + 1) / steps.length) * 100}
            color="brand"
            size="sm"
            radius="xl"
          />
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

        {/* ── ЦА ── */}
        {stepId === "audience" && (
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Превью делается под аудиторию, а не «чтобы красиво». От этого зависят кегль
              текста, палитра и то, насколько сильную эмоцию можно давать.
            </Text>
            <Stack gap={6}>
              {AUDIENCE_PRESETS.map((p) => (
                <PickCard
                  key={p.id}
                  active={spec.audiencePreset === p.id}
                  title={p.label}
                  hint={p.hint}
                  onClick={() => set("audiencePreset", p.id)}
                />
              ))}
            </Stack>
            {(spec.niche || spec.audience) && (
              <Text size="xs" c="dimmed">
                Из брифа проекта: {spec.niche || "ниша не указана"}
                {spec.audience ? ` · ${spec.audience}` : ""}
              </Text>
            )}
          </Stack>
        )}

        {/* ── Стиль ── */}
        {stepId === "style" && (
          <Stack gap="sm">
            <Stack gap={6}>
              {THUMB_STYLES.map((s) => (
                <PickCard
                  key={s.id}
                  active={spec.style === s.id}
                  title={s.label}
                  hint={s.hint}
                  badge={
                    s.speaker === "required"
                      ? "нужно фото спикера"
                      : s.speaker === "none"
                        ? "без спикера"
                        : undefined
                  }
                  onClick={() => {
                    set("style", s.id);
                    set("subStyle", "");
                  }}
                />
              ))}
            </Stack>

            {style.subStyles?.length ? (
              <Box>
                <Text size="sm" fw={500} mb={6}>
                  Какой именно спецпроект
                </Text>
                <Stack gap={6}>
                  {style.subStyles.map((s) => (
                    <PickCard
                      key={s.id}
                      active={spec.subStyle === s.id}
                      title={s.label}
                      hint={s.hint}
                      onClick={() => set("subStyle", s.id)}
                    />
                  ))}
                </Stack>
              </Box>
            ) : null}
          </Stack>
        )}

        {/* ── Кто в кадре ── */}
        {stepId === "frame" && (
          <Stack gap="sm">
            <Box>
              <Text size="sm" fw={500} mb={4}>
                Сколько людей на превью
              </Text>
              <SegmentedControl
                color="brand"
                value={String(spec.peopleCount)}
                onChange={(v) => {
                  const n = Number(v);
                  set("peopleCount", n);
                  // «Без людей» → эмоцию носить некому (см. эффект выше).
                  if (n === 0) set("emotion", "");
                }}
                data={[
                  { value: "0", label: "Без людей" },
                  { value: "1", label: "Один" },
                  { value: "2", label: "Двое" },
                ]}
              />
              {speakerNeed === "required" && spec.peopleCount === 0 && (
                <Text size="xs" c="red" mt={4}>
                  Этот стиль строится вокруг спикера — без человека он рассыплется.
                </Text>
              )}
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

            <Group grow align="flex-start">
              {spec.peopleCount > 0 && (
                <TextInput
                  label="Эмоция"
                  placeholder="например: тревога, азарт, спокойная уверенность"
                  maxLength={SPEC_LIMITS.emotion}
                  value={spec.emotion}
                  onChange={(e) => set("emotion", e.currentTarget.value)}
                />
              )}
              <TextInput
                label="Что ещё в кадре"
                placeholder="один предмет, о котором ролик"
                maxLength={SPEC_LIMITS.supportObject}
                value={spec.supportObject}
                onChange={(e) => set("supportObject", e.currentTarget.value)}
              />
            </Group>
          </Stack>
        )}

        {/* ── О чём ролик ── */}
        {stepId === "topic" && (
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
            <Textarea
              label="Особые пожелания к кадру"
              description="Необязательно. Если хочешь конкретную сцену — опиши своими словами."
              autosize
              minRows={2}
              maxRows={5}
              maxLength={SPEC_LIMITS.instructions}
              value={spec.instructions}
              onChange={(e) => set("instructions", e.currentTarget.value)}
            />
          </Stack>
        )}

        {/* ── Текст и название ── */}
        {stepId === "text" && (
          <Stack gap="md">
            {/* ── Из контент-плана: готовая упаковка, бесплатно ── */}
            {planCards === null && (
              <Group gap="xs">
                <Loader size="xs" color="brand" />
                <Text size="sm" c="dimmed">
                  Смотрю контент-план…
                </Text>
              </Group>
            )}
            {planCards && planCards.length > 0 && (
              <Box>
                <Text size="sm" fw={500} mb={2}>
                  Взять из контент-плана
                </Text>
                <Text size="xs" c="dimmed" mb={6}>
                  У карточек плана название и текст на превью уже собраны по методике —
                  выбери ролик, под который делаешь обложку.
                </Text>
                <Select
                  searchable
                  clearable
                  placeholder="Выбери ролик из плана…"
                  value={pickedCard}
                  data={planCards.map((c) => ({
                    value: c.id,
                    label: (c.kind === "short" ? "[Shorts] " : "") + c.title,
                  }))}
                  onChange={(id) => {
                    setPickedCard(id);
                    const card = planCards.find((c) => c.id === id);
                    if (!card) return;
                    // Заполняем ОБА поля разом; главное слово оставляем пустым —
                    // промпт сам поднимет капсом самое важное (фолбэк в
                    // buildThumbnailPrompt), а руками поправить можно ниже.
                    set("videoTitle", card.title);
                    set("thumbText", card.previewText);
                  }}
                />
              </Box>
            )}

            {/* Подсказка от ИИ — по явной кнопке, а не автоматом: 1 запрос квоты
                и десяток секунд ожидания должны быть осознанным действием. */}
            {!ideas && (
              <Button
                variant="light"
                color="brand"
                leftSection={<IconSparkles size={16} />}
                loading={ideasLoading}
                onClick={() => void askIdeas()}
              >
                Предложить названия и текст по методике · {THUMBNAIL_SPEC_QUOTA_COST}
              </Button>
            )}

            {ideas && ideas.titles.length > 0 && (
              <Box>
                <Text size="sm" fw={500} mb={6}>
                  Название ролика — выбери или напиши своё
                </Text>
                <Stack gap={6}>
                  {ideas.titles.map((t) => (
                    <PickCard
                      key={t}
                      active={spec.videoTitle === t}
                      title={t}
                      onClick={() => set("videoTitle", t)}
                    />
                  ))}
                </Stack>
              </Box>
            )}

            <TextInput
              label="Название ролика"
              description="На превью его НЕ рисуем — нужно, чтобы текст на превью его не повторял."
              maxLength={SPEC_LIMITS.videoTitle}
              value={spec.videoTitle}
              onChange={(e) => set("videoTitle", e.currentTarget.value)}
            />

            {ideas && ideas.thumbTexts.length > 0 && (
              <Box>
                <Text size="sm" fw={500} mb={6}>
                  Текст на превью
                </Text>
                <Stack gap={6}>
                  {ideas.thumbTexts.map((t) => (
                    <PickCard
                      key={t.text}
                      active={spec.thumbText === t.text}
                      title={t.text}
                      hint={t.why}
                      onClick={() => {
                        set("thumbText", t.text);
                        set("keyWord", t.keyWord);
                      }}
                    />
                  ))}
                </Stack>
              </Box>
            )}

            <Group grow align="flex-start">
              <TextInput
                label="Текст на превью"
                description="Не больше пяти слов. Пусто — нарисую без текста."
                maxLength={SPEC_LIMITS.thumbText}
                value={spec.thumbText}
                onChange={(e) => set("thumbText", e.currentTarget.value)}
              />
              <TextInput
                label="Главное слово"
                description="Его поставлю капсом и крупнее."
                maxLength={SPEC_LIMITS.keyWord}
                value={spec.keyWord}
                onChange={(e) => set("keyWord", e.currentTarget.value)}
              />
            </Group>

            <Box>
              <Group justify="space-between" mb={6} wrap="nowrap">
                <Text size="sm" fw={500}>
                  Свой референс стиля
                </Text>
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
              {styleRefs.length > 0 && (
                <RefPicker
                  rows={styleRefs}
                  selected={styleIds}
                  onToggle={(id) =>
                    setStyleIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
                  }
                />
              )}
              {/* Насколько повторять референс — бальность 1/3/5 из студийного ТЗ.
                  Раньше жила только в промпте с дефолтом «не копировать». */}
              {styleIds.length > 0 && (
                <Box mt="sm">
                  <Text size="sm" fw={500} mb={4}>
                    Насколько повторять референс
                  </Text>
                  <SegmentedControl
                    color="brand"
                    fullWidth
                    value={spec.refScore}
                    onChange={(v) => set("refScore", v)}
                    data={[
                      { value: "5", label: "Повторить 1 в 1" },
                      { value: "3", label: "Взять приём" },
                      { value: "1", label: "Только настроение" },
                    ]}
                  />
                  {spec.refScore === "3" && (
                    <TextInput
                      mt={6}
                      placeholder="что именно взять — например: жёлтые плашки под текстом"
                      maxLength={SPEC_LIMITS.refElement}
                      value={spec.refElement}
                      onChange={(e) => set("refElement", e.currentTarget.value)}
                    />
                  )}
                  {spec.refScore === "5" && styleIds.length > 1 && (
                    <Text size="xs" c="dimmed" mt={4}>
                      Для точного повтора лучше оставить ОДИН референс: при нескольких копирую
                      композицию первого, остальные — только палитра и настроение.
                    </Text>
                  )}
                </Box>
              )}
            </Box>
          </Stack>
        )}

        {/* ── Сводка ── */}
        {stepId === "review" && (
          <Stack gap="sm">
            {/* ⚠️ Громкое предупреждение, а не приписка мелким шрифтом: личность
                спикера переносится ТОЛЬКО с фото роли «Спикер» (IDENTITY LOCK).
                Стиль-референсы — включая обложки, взятые «С канала», — учат
                раскладке, но лица не несут: оно там мелкое и заклеено плашками.
                Ловили на проде: человек взял за основу обложки канала, получил
                случайное лицо и законно спросил «а почему не мой спикер?». */}
            {spec.peopleCount > 0 && speakerIds.length === 0 && (
              <Alert color="orange" variant="light" icon={<IconAlertCircle size={16} />}>
                <Text size="sm" fw={600}>
                  В кадре будет человек, но фото спикера не приложено
                </Text>
                <Text size="xs" mt={4}>
                  Лицо нарисуется СЛУЧАЙНОЕ — на реального спикера оно похоже не будет.
                  Обложки-стили тут не помогают: они задают вид превью, а личность
                  переносится только с чистого фото. Вернись на шаг «Кто в кадре» и
                  добавь фото спикера — или выбери «без людей».
                </Text>
              </Alert>
            )}
            <Paper radius="md" p="sm" className="an-surface">
              <Stack gap={6}>
                <SummaryRow label="Аудитория" value={audienceLabel(spec.audiencePreset)} />
                <SummaryRow
                  label="Стиль"
                  value={
                    style.label +
                    (spec.subStyle
                      ? ` · ${style.subStyles?.find((s) => s.id === spec.subStyle)?.label ?? ""}`
                      : "")
                  }
                />
                {/* Референсы из сводки убраны (решение владельца): человеку тут важно
                    проверить смысл превью, а не служебный учёт приложенных файлов. */}
                <SummaryRow
                  label="В кадре"
                  value={spec.peopleCount === 0 ? "без людей" : spec.peopleCount === 2 ? "двое" : "один"}
                />
                {spec.peopleCount > 0 && <SummaryRow label="Эмоция" value={spec.emotion} />}
                <SummaryRow label="Что ещё в кадре" value={spec.supportObject} />
                <SummaryRow label="Текст на превью" value={spec.thumbText || "без текста"} />
                <SummaryRow label="Главное слово" value={spec.keyWord} />
                <SummaryRow label="Название ролика" value={spec.videoTitle} />
                <SummaryRow label="О чём ролик" value={spec.videoSummary} />
              </Stack>
            </Paper>

            <Alert color="brand" variant="light" icon={<IconInfoCircle size={16} />}>
              <Text size="sm" fw={600}>
                Это черновик, а не готовая обложка
              </Text>
              <Text size="xs" mt={4}>
                Картинку рисует нейросеть: композиция, эмоция и текст — рабочая рекомендация под
                методику, но лица, руки и мелкие детали она путает. Перед публикацией отдай превью
                дизайнеру или доведи сам — это заготовка, с которой удобно начинать.
              </Text>
            </Alert>

            <Text size="xs" c="dimmed">
              Что-то не так — вернись назад и поправь.
            </Text>

            {/* ТЗ для image-модели спрятано от пользователя (решение владельца): это
                служебный английский промпт, человеку он ничего не объясняет и только
                пугает. Оставлен под спойлером ТОЛЬКО для админов — им он нужен, когда
                разбираешь, почему картинка вышла не такой. */}
            {isAdmin && (
              <Spoiler maxHeight={0} showLabel="Показать ТЗ для модели" hideLabel="Скрыть ТЗ">
                <ScrollArea.Autosize mah={280} type="auto" offsetScrollbars>
                  <Code block style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>
                    {previewPrompt}
                  </Code>
                </ScrollArea.Autosize>
              </Spoiler>
            )}
          </Stack>
        )}

        {/* Навигация */}
        <Group justify="space-between" mt="xs">
          <Button variant="subtle" color="gray" onClick={goBack} disabled={busy}>
            {stepIndex === 0 ? "Отмена" : "Назад"}
          </Button>
          {stepId !== "review" ? (
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
        {stepId === "review" && (
          <Text size="xs" c="dimmed" ta="center">
            Одна картинка — {THUMBNAIL_GENERATE_QUOTA_COST} запросов из тарифа. Рисуется до
            минуты.
          </Text>
        )}
      </Stack>
    </Modal>
  );
}

function audienceLabel(id: string): string {
  return AUDIENCE_PRESETS.find((p) => p.id === id)?.label ?? "";
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  if (!value?.trim()) return null;
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Text size="xs" c="dimmed" style={{ minWidth: 130, flexShrink: 0 }}>
        {label}
      </Text>
      <Text size="sm" style={{ minWidth: 0 }}>
        {value}
      </Text>
    </Group>
  );
}

// Карточка выбора: ЦА, стиль, вариант названия. Клик — выбрать.
function PickCard({
  active,
  title,
  hint,
  badge,
  onClick,
}: {
  active: boolean;
  title: string;
  hint?: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton onClick={onClick} aria-pressed={active}>
      <Paper
        radius="md"
        p="sm"
        className="an-surface"
        style={{
          outline: active ? "2px solid var(--mantine-color-brand-6)" : "2px solid transparent",
        }}
      >
        <Group justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
          <Box style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <Text fw={600} size="sm">
                {title}
              </Text>
              {badge && (
                <Badge size="xs" variant="light" color="gray">
                  {badge}
                </Badge>
              )}
            </Group>
            {hint && (
              <Text size="xs" c="dimmed" mt={2}>
                {hint}
              </Text>
            )}
          </Box>
          {active && (
            <ThemeIcon size="sm" radius="xl" color="brand" variant="filled">
              <IconCheck size={12} />
            </ThemeIcon>
          )}
        </Group>
      </Paper>
    </UnstyledButton>
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
