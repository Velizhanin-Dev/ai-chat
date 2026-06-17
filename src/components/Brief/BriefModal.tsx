"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Stepper,
  Stack,
  Group,
  Button,
  TextInput,
  Textarea,
  Select,
  Radio,
  Text,
  Title,
  Paper,
  ThemeIcon,
  Alert,
  List,
  Progress,
} from "@mantine/core";
import {
  IconClipboardText,
  IconUser,
  IconSparkles,
  IconCheck,
  IconAlertCircle,
  IconArrowRight,
  IconArrowLeft,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { authenticated } from "@/store/authSlice";
import { apiSaveBrief } from "@/lib/auth-client";
import {
  EMPTY_BRIEF,
  CAMERA_OPTIONS,
  DISC_QUESTIONS,
  DISC_PROFILES,
  scoreDisc,
  type Brief,
  type DiscAxis,
  type DiscType,
} from "@/lib/brief";

// Шаг «О проекте» теперь идёт по одному вопросу за раз (Typeform-style). Каждый
// пункт — отдельный экран: крупный вопрос + одно поле. Берём только то, что
// реально использует модель. Камера — последний пункт (select).
type ProjectItem =
  | {
      kind: "text";
      key: keyof Pick<
        Brief,
        "channel" | "niche" | "product" | "audience" | "expertise" | "goal" | "forbidden"
      >;
      label: string;
      placeholder: string;
      required: boolean;
      area?: boolean;
      hint?: string;
    }
  | { kind: "camera"; label: string; required: boolean; hint?: string };

const PROJECT_ITEMS: ProjectItem[] = [
  {
    kind: "text",
    key: "channel",
    label: "Как называется твой канал или проект?",
    placeholder: "Название канала или бренда",
    required: true,
    hint: "Нет названия — напиши рабочее, потом поменяем.",
  },
  {
    kind: "text",
    key: "niche",
    label: "Чем ты занимаешься?",
    placeholder: "Например: онлайн-школа английского, барбершоп, B2B-разработка",
    required: true,
  },
  {
    kind: "text",
    key: "product",
    label: "Что продвигаешь через YouTube?",
    placeholder: "Продукт или услуга, которую хочешь продавать через контент",
    required: true,
    area: true,
  },
  {
    kind: "text",
    key: "audience",
    label: "Кто твоя аудитория?",
    placeholder: "Кто смотрит и покупает: пол, возраст, чем живут, что болит",
    required: true,
    area: true,
  },
  {
    kind: "text",
    key: "expertise",
    label: "В чём ты силён как спикер?",
    placeholder: "О чём можешь говорить часами, где ты реально эксперт",
    required: true,
    area: true,
  },
  {
    kind: "text",
    key: "goal",
    label: "Зачем тебе YouTube?",
    placeholder: "Цель: продажи, лиды, личный бренд, охваты…",
    required: true,
  },
  {
    kind: "text",
    key: "forbidden",
    label: "Есть запретные темы?",
    placeholder: "О чём говорить нельзя — политика, конкуренты, личное…",
    required: false,
    hint: "Необязательно — можно пропустить.",
  },
  {
    kind: "camera",
    label: "Какой у тебя опыт на камере?",
    required: true,
  },
];

const PROJECT_TOTAL = PROJECT_ITEMS.length;
const DISC_TOTAL = DISC_QUESTIONS.length;

// ── Черновик брифа в localStorage ───────────────────────────────────────────
// Чтобы прогресс онбординга не терялся при обновлении страницы / плохом
// интернете. Один ключ на пользователя (валидируем userId), пишем на каждое
// изменение, чистим после успешного сохранения. Ключ в общем неймспейсе
// приложения (creative-chat:*-v1, см. StoreProvider).
const DRAFT_KEY = "creative-chat:brief-draft-v1";

interface BriefDraft {
  userId: string;
  form: Brief;
  answers: (number | null)[];
  step: number;
  sub: number;
}

function loadBriefDraft(userId: string): BriefDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<BriefDraft>;
    if (!d || d.userId !== userId) return null;
    // Экран результата (step 2) не восстанавливаем — это уже сохранённый бриф.
    if (typeof d.step !== "number" || d.step >= 2) return null;
    // Нормализуем под актуальную структуру теста: вопросы/опции могли поменяться.
    const answers = DISC_QUESTIONS.map((q, i) => {
      const a = Array.isArray(d.answers) ? d.answers[i] : null;
      return typeof a === "number" && a >= 0 && a < q.options.length ? a : null;
    });
    const form: Brief = { ...EMPTY_BRIEF, ...(d.form ?? {}) };
    const step = d.step === 1 ? 1 : 0;
    const max = step === 0 ? PROJECT_TOTAL - 1 : DISC_TOTAL - 1;
    const sub = typeof d.sub === "number" && d.sub >= 0 && d.sub <= max ? d.sub : 0;
    return { userId, form, answers, step, sub };
  } catch {
    return null;
  }
}

function saveBriefDraft(d: BriefDraft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* приватный режим / превышена квота — не критично */
  }
}

function clearBriefDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

// Есть ли в черновике реальный прогресс (чтобы не плодить пустые записи).
function draftHasProgress(
  form: Brief,
  answers: (number | null)[],
  step: number,
  sub: number
) {
  if (step > 0 || sub > 0) return true;
  if (answers.some((a) => a !== null)) return true;
  return Object.values(form).some(
    (v) => typeof v === "string" && v.trim().length > 0
  );
}

export default function BriefModal({
  opened,
  onClose,
  mandatory = false,
}: {
  opened: boolean;
  onClose: () => void;
  mandatory?: boolean;
}) {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);

  // step: 0 — о проекте, 1 — о себе (DISC), 2 — результат (тип харизмы).
  const [step, setStep] = useState(0);
  // sub — индекс текущего вопроса внутри шага (вопросы идут по одному).
  const [sub, setSub] = useState(0);
  const [form, setForm] = useState<Brief>(EMPTY_BRIEF);
  // Ответы DISC: индекс выбранной опции на каждый вопрос (или null).
  const [answers, setAnswers] = useState<(number | null)[]>(
    () => DISC_QUESTIONS.map(() => null)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiscType | null>(null);

  // Автопереход после выбора ответа в тесте «о себе» — с маленькой задержкой,
  // чтобы выбор успел подсветиться. Таймер чистим при размонтировании/закрытии.
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAdvance = () => {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  };

  // Фокус на активное поле при смене вопроса в шаге «о проекте».
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  // Восстанавливаем состояние ТОЛЬКО на переходе «закрыто → открыто», а не на
  // каждом изменении user.brief. Иначе сохранение брифа (authenticated → меняет
  // user.brief) тут же ретригерит сброс и затирает экран результата.
  // Приоритет: незавершённый черновик из localStorage (пережил обновление
  // страницы) → иначе уже сохранённый бриф (режим «пройти заново») → иначе пусто.
  const wasOpen = useRef(false);
  // Пропустить один прогон эффекта сохранения сразу после восстановления, чтобы
  // не перезаписать черновик stale-состоянием до коммита restore.
  const skipPersist = useRef(false);
  useEffect(() => {
    if (opened && !wasOpen.current) {
      const draft = user ? loadBriefDraft(user.id) : null;
      if (draft) {
        setForm(draft.form);
        setAnswers(draft.answers);
        setStep(draft.step);
        setSub(draft.sub);
      } else {
        setForm(user?.brief ?? EMPTY_BRIEF);
        setAnswers(DISC_QUESTIONS.map(() => null));
        setStep(0);
        setSub(0);
      }
      setError(null);
      setResult(null);
      skipPersist.current = true;
    }
    wasOpen.current = opened;
    if (!opened) clearAdvance();
    return clearAdvance;
  }, [opened, user?.brief]);

  // Пишем черновик на каждое изменение, пока модалка открыта и мы не на экране
  // результата. Первый прогон после restore пропускаем (см. skipPersist).
  useEffect(() => {
    if (!opened || result || step >= 2 || !user) return;
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    if (draftHasProgress(form, answers, step, sub)) {
      saveBriefDraft({ userId: user.id, form, answers, step, sub });
    } else {
      clearBriefDraft();
    }
  }, [opened, user, form, answers, step, sub, result]);

  useEffect(() => {
    if (!opened || step !== 0) return;
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [opened, step, sub]);

  const setField = (key: keyof Brief, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Заполнен ли конкретный пункт «о проекте».
  const itemFilled = (it: ProjectItem) =>
    it.kind === "camera"
      ? Boolean(form.cameraExp)
      : String(form[it.key] ?? "").trim().length > 0;

  // current определён только на шаге «о проекте»; на шаге «о себе» sub индексирует
  // вопросы DISC и выходит за пределы PROJECT_ITEMS — поэтому null-safe.
  const current = step === 0 ? PROJECT_ITEMS[sub] : null;
  const isLastProject = sub === PROJECT_TOTAL - 1;
  const canAdvanceProject = !current || !current.required || itemFilled(current);

  const isLastQuestion = sub === DISC_TOTAL - 1;
  const allAnswered = answers.every((a) => a !== null);

  // ── Навигация ──────────────────────────────────────────────────────────────
  const goBack = () => {
    clearAdvance();
    setError(null);
    if (sub > 0) {
      setSub((s) => s - 1);
      return;
    }
    if (step === 1) {
      setStep(0);
      setSub(PROJECT_TOTAL - 1);
    }
  };

  const projectNext = () => {
    if (!canAdvanceProject) return;
    setError(null);
    if (!isLastProject) {
      setSub((s) => s + 1);
    } else {
      setStep(1);
      setSub(0);
    }
  };

  // Выбор ответа в тесте: фиксируем и через паузу едем дальше (или финишируем).
  const pickAnswer = (qi: number, oi: number) => {
    const next = [...answers];
    next[qi] = oi;
    setAnswers(next);
    clearAdvance();
    advanceTimer.current = setTimeout(() => {
      if (qi < DISC_TOTAL - 1) setSub(qi + 1);
      else void finish(next);
    }, 280);
  };

  const finish = async (finalAnswers: (number | null)[]) => {
    if (saving) return;
    if (finalAnswers.some((a) => a === null)) return;
    const axes: DiscAxis[] = finalAnswers.map(
      (a, i) => DISC_QUESTIONS[i].options[a as number].axis
    );
    const disc = scoreDisc(axes);
    const brief: Brief = { ...form, disc };

    setSaving(true);
    setError(null);
    const res = await apiSaveBrief(brief);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    clearBriefDraft();
    dispatch(authenticated(res.data.user));
    setResult(disc);
    setStep(2);
  };

  const profile = result ? DISC_PROFILES[result] : null;

  // Прогресс внутри текущего шага.
  const innerTotal = step === 0 ? PROJECT_TOTAL : DISC_TOTAL;
  const innerValue = ((sub + 1) / innerTotal) * 100;

  // ── Рендер активного поля «о проекте» ───────────────────────────────────────
  const renderProjectField = () => {
    if (!current) return null;
    if (current.kind === "camera") {
      return (
        <Select
          ref={inputRef}
          placeholder="Выбери вариант"
          size="md"
          value={form.cameraExp || null}
          onChange={(v) => setField("cameraExp", v ?? "")}
          data={CAMERA_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          allowDeselect={false}
        />
      );
    }
    if (current.area) {
      return (
        <Textarea
          ref={inputRef}
          placeholder={current.placeholder}
          size="md"
          value={String(form[current.key] ?? "")}
          onChange={(e) => setField(current.key, e.currentTarget.value)}
          autosize
          minRows={3}
          maxRows={6}
        />
      );
    }
    return (
      <TextInput
        ref={inputRef}
        placeholder={current.placeholder}
        size="md"
        value={String(form[current.key] ?? "")}
        onChange={(e) => setField(current.key, e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            projectNext();
          }
        }}
      />
    );
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="md"
      radius="lg"
      centered
      withCloseButton={!mandatory}
      closeOnClickOutside={!mandatory}
      closeOnEscape={!mandatory}
      title={
        <Group gap="xs">
          <ThemeIcon color="brand" variant="light" radius="md" size="md">
            <IconClipboardText size={16} />
          </ThemeIcon>
          <Text fw={600} fz="lg">
            {result ? "Готово!" : "Знакомство перед стартом"}
          </Text>
        </Group>
      }
    >
      <Stepper
        active={step}
        onStepClick={(s) => {
          // Назад ходить можно; вперёд — нет. После результата — заблокировано.
          if (result) return;
          if (s < step) {
            clearAdvance();
            setError(null);
            setStep(s);
            setSub(0);
          }
        }}
        color="brand"
        size="sm"
        mb="lg"
        allowNextStepsSelect={false}
      >
        <Stepper.Step label="О проекте" icon={<IconClipboardText size={16} />} />
        <Stepper.Step label="О себе" icon={<IconUser size={16} />} />
        <Stepper.Completed>{null}</Stepper.Completed>
      </Stepper>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          mb="md"
          withCloseButton
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      {/* Прогресс внутри шага (вопрос n из N) — не на экране результата. */}
      {step !== 2 && (
        <Stack gap={6} mb="lg">
          <Progress value={innerValue} color="brand" size="sm" radius="xl" />
          <Text size="xs" c="dimmed" ta="right">
            {sub + 1} / {innerTotal}
          </Text>
        </Stack>
      )}

      {/* ── Шаг 1: бриф о проекте, по одному вопросу ───────────────────────── */}
      {step === 0 && current && (
        <Stack gap="lg">
          <div>
            <Title order={4}>
              {current.label}
              {current.required && (
                <Text span c="brand" inherit>
                  {" "}
                  *
                </Text>
              )}
            </Title>
            {current.hint && (
              <Text size="sm" c="dimmed" mt={6}>
                {current.hint}
              </Text>
            )}
          </div>

          {renderProjectField()}

          <Group justify="space-between" mt="xs">
            <Button
              variant="subtle"
              color="gray"
              radius="md"
              leftSection={<IconArrowLeft size={16} />}
              onClick={goBack}
              disabled={sub === 0}
            >
              Назад
            </Button>
            <Button
              color="brand"
              radius="md"
              rightSection={<IconArrowRight size={16} />}
              disabled={!canAdvanceProject}
              onClick={projectNext}
            >
              {isLastProject
                ? "Дальше — пара вопросов о тебе"
                : !current.required && !itemFilled(current)
                ? "Пропустить"
                : "Дальше"}
            </Button>
          </Group>
        </Stack>
      )}

      {/* ── Шаг 2: вопросы «о себе» (DISC), по одному ──────────────────────── */}
      {step === 1 && (
        <Stack gap="lg">
          {sub === 0 && (
            <Text size="sm" c="dimmed">
              Теперь — пара вопросов про тебя: как ты в кадре, что заводит, что
              бесит. Отвечай по первому ощущению, правильных ответов нет.
            </Text>
          )}

          <Title order={4}>{DISC_QUESTIONS[sub].q}</Title>

          <Radio.Group
            value={answers[sub] === null ? "" : String(answers[sub])}
            onChange={(v) => pickAnswer(sub, Number(v))}
          >
            <Stack gap="sm">
              {DISC_QUESTIONS[sub].options.map((opt, oi) => (
                <Radio.Card
                  key={oi}
                  value={String(oi)}
                  radius="md"
                  p="sm"
                  style={{ cursor: "pointer" }}
                >
                  <Group wrap="nowrap" align="flex-start" gap="sm">
                    <Radio.Indicator color="brand" mt={2} />
                    <Text size="sm">{opt.label}</Text>
                  </Group>
                </Radio.Card>
              ))}
            </Stack>
          </Radio.Group>

          <Group justify="space-between" mt="xs">
            <Button
              variant="subtle"
              color="gray"
              radius="md"
              leftSection={<IconArrowLeft size={16} />}
              onClick={goBack}
            >
              Назад
            </Button>
            <Button
              color="brand"
              radius="md"
              rightSection={
                isLastQuestion ? <IconSparkles size={16} /> : <IconArrowRight size={16} />
              }
              disabled={answers[sub] === null}
              loading={saving && isLastQuestion}
              onClick={() => {
                clearAdvance();
                if (isLastQuestion) void finish(answers);
                else setSub((s) => s + 1);
              }}
            >
              {isLastQuestion ? "Узнать мой типаж" : "Дальше"}
            </Button>
          </Group>
        </Stack>
      )}

      {/* ── Шаг 3: результат — раскрываем типаж харизмы ────────────────────── */}
      {step === 2 && profile && (
        <Stack gap="md">
          <Paper withBorder radius="md" p="md">
            <Group gap="xs" mb="xs">
              <ThemeIcon color="brand" variant="light" radius="xl" size="lg">
                <IconSparkles size={18} />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed">
                  Твой типаж на камере
                </Text>
                <Title order={4}>
                  «{profile.nick}»{" "}
                  <Text span c="dimmed" fz="sm">
                    ({profile.code})
                  </Text>
                </Title>
              </div>
            </Group>
            <Text size="sm" mb="sm">
              {profile.character}
            </Text>
            <List size="sm" spacing={4}>
              <List.Item>
                <Text span fw={500}>
                  Форматы под тебя:
                </Text>{" "}
                {profile.formats}
              </List.Item>
              <List.Item>
                <Text span fw={500}>
                  Что тебя заводит:
                </Text>{" "}
                {profile.works}
              </List.Item>
            </List>
          </Paper>
          <Text size="sm" c="dimmed">
            Готово — я буду это учитывать в каждом ответе. Поменять можно в любой
            момент в настройках, кнопка «Пройти бриф заново».
          </Text>
          <Group justify="flex-end">
            <Button
              color="brand"
              radius="md"
              rightSection={<IconArrowRight size={16} />}
              onClick={onClose}
            >
              Поехали в чат
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
