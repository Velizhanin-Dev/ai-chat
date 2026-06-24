"use client";

import { useEffect, useRef, useState } from "react";
import {
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
  Loader,
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
import {
  EMPTY_BRIEF,
  BRIEF_LIMITS,
  CAMERA_OPTIONS,
  DISC_QUESTIONS,
  DISC_PROFILES,
  scoreDisc,
  type Brief,
  type DiscAxis,
  type DiscType,
} from "@/lib/brief";

// ── Общий мастер брифа (модалка онбординга + страница по QR) ─────────────────
// Один Typeform-style визард: шаг «о проекте» по одному вопросу → DISC-тест по
// одному вопросу → экран результата (тип харизмы). Все поля «о проекте»
// НЕОБЯЗАТЕЛЬНЫ (кнопка «Пропустить» на пустом поле); обязателен только DISC.
//
// Куда сохранять результат и что показывать на финале — решает родитель через
// пропсы (onSubmit / resultNote / resultActions). Так модалка кладёт бриф на
// бэкенд и ведёт в чат, а страница по QR — в localStorage и ведёт на главную.

// Шаг «О проекте» — по одному пункту за экран. Берём только то, что реально
// использует модель. Камера — последний пункт (select).
type ProjectItem =
  | {
      kind: "text";
      key: keyof typeof BRIEF_LIMITS;
      label: string;
      placeholder: string;
      area?: boolean;
      hint?: string;
    }
  | { kind: "camera"; label: string; hint?: string };

const PROJECT_ITEMS: ProjectItem[] = [
  {
    kind: "text",
    key: "channel",
    label: "Как называется твой канал или проект?",
    placeholder: "Название канала или бренда",
    hint: "Нет названия — напиши рабочее, потом поменяем.",
  },
  {
    kind: "text",
    key: "niche",
    label: "Чем ты занимаешься?",
    placeholder: "Например: онлайн-школа английского, барбершоп, B2B-разработка",
  },
  {
    kind: "text",
    key: "product",
    label: "Что продвигаешь через YouTube?",
    placeholder: "Продукт или услуга, которую хочешь продавать через контент",
    area: true,
  },
  {
    kind: "text",
    key: "audience",
    label: "Кто твоя аудитория?",
    placeholder: "Кто смотрит и покупает: пол, возраст, чем живут, что болит",
    area: true,
  },
  {
    kind: "text",
    key: "expertise",
    label: "В чём ты силён как спикер?",
    placeholder: "О чём можешь говорить часами, где ты реально эксперт",
    area: true,
  },
  {
    kind: "text",
    key: "goal",
    label: "Зачем тебе YouTube?",
    placeholder: "Цель: продажи, лиды, личный бренд, охваты…",
  },
  {
    kind: "text",
    key: "forbidden",
    label: "Есть запретные темы?",
    placeholder: "О чём говорить нельзя — политика, конкуренты, личное…",
    hint: "Необязательно — можно пропустить.",
  },
  {
    kind: "camera",
    label: "Какой у тебя опыт на камере?",
  },
];

const PROJECT_TOTAL = PROJECT_ITEMS.length;
const DISC_TOTAL = DISC_QUESTIONS.length;

// ── Черновик прогресса в localStorage ───────────────────────────────────────
// Чтобы прогресс не терялся при обновлении страницы / плохом интернете. Ключ и
// «владелец» (scope: userId или "anon") приходят от родителя — один механизм для
// модалки и страницы. Пишем на каждое изменение, чистим после сохранения.
interface BriefDraft {
  scope: string;
  form: Brief;
  answers: (number | null)[];
  step: number;
  sub: number;
}

function loadBriefDraft(key: string, scope: string): BriefDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<BriefDraft>;
    if (!d || d.scope !== scope) return null;
    // Экран результата (step 2) не восстанавливаем — это уже готовый бриф.
    if (typeof d.step !== "number" || d.step >= 2) return null;
    const answers = DISC_QUESTIONS.map((q, i) => {
      const a = Array.isArray(d.answers) ? d.answers[i] : null;
      return typeof a === "number" && a >= 0 && a < q.options.length ? a : null;
    });
    const form: Brief = { ...EMPTY_BRIEF, ...(d.form ?? {}) };
    const step = d.step === 1 ? 1 : 0;
    const max = step === 0 ? PROJECT_TOTAL - 1 : DISC_TOTAL - 1;
    const sub = typeof d.sub === "number" && d.sub >= 0 && d.sub <= max ? d.sub : 0;
    return { scope, form, answers, step, sub };
  } catch {
    return null;
  }
}

function saveBriefDraft(key: string, d: BriefDraft) {
  try {
    localStorage.setItem(key, JSON.stringify(d));
  } catch {
    /* приватный режим / превышена квота — не критично */
  }
}

function clearBriefDraft(key: string) {
  try {
    localStorage.removeItem(key);
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

export interface BriefFlowProps {
  // Стартовые значения формы (например, уже сохранённый бриф в режиме «пройти
  // заново»). Черновик из localStorage, если есть, имеет приоритет.
  initialBrief?: Brief | null;
  // Ключ и владелец черновика прогресса в localStorage.
  draftKey: string;
  draftScope: string;
  // Куда сохранить готовый бриф. ok=false → показываем error и остаёмся в тесте.
  onSubmit: (brief: Brief) => Promise<{ ok: boolean; error?: string }>;
  // Текст-пояснение на экране результата (под карточкой типажа).
  resultNote?: React.ReactNode;
  // Кнопки на экране результата. restart — снова с первого шага.
  resultActions: (ctx: { restart: () => void }) => React.ReactNode;
}

export default function BriefFlow({
  initialBrief,
  draftKey,
  draftScope,
  onSubmit,
  resultNote,
  resultActions,
}: BriefFlowProps) {
  // step: 0 — о проекте, 1 — о себе (DISC), 2 — результат (тип харизмы).
  const [step, setStep] = useState(0);
  // sub — индекс текущего вопроса внутри шага (вопросы идут по одному).
  const [sub, setSub] = useState(0);
  const [form, setForm] = useState<Brief>(EMPTY_BRIEF);
  const [answers, setAnswers] = useState<(number | null)[]>(() =>
    DISC_QUESTIONS.map(() => null)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiscType | null>(null);
  // localStorage читается только на клиенте, в эффекте на маунте. Пока черновик
  // не восстановлен — показываем лоадер, чтобы при случайном обновлении страницы
  // не мигнул первый вопрос вместо места, где юзер остановился.
  const [hydrated, setHydrated] = useState(false);

  // Автопереход после выбора ответа в тесте «о себе» — с маленькой задержкой,
  // чтобы выбор успел подсветиться. Таймер чистим при размонтировании.
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAdvance = () => {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  };

  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  // Восстановление ОДИН РАЗ на маунте (компонент монтируется заново на каждое
  // открытие модалки / заход на страницу). Приоритет: незавершённый черновик из
  // localStorage → стартовый бриф (режим «пройти заново») → пусто.
  const skipPersist = useRef(false);
  useEffect(() => {
    const draft = loadBriefDraft(draftKey, draftScope);
    if (draft) {
      setForm(draft.form);
      setAnswers(draft.answers);
      setStep(draft.step);
      setSub(draft.sub);
    } else if (initialBrief) {
      setForm({ ...EMPTY_BRIEF, ...initialBrief });
    }
    skipPersist.current = true;
    setHydrated(true);
    return clearAdvance;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Пишем черновик на каждое изменение, пока не на экране результата. Первый
  // прогон после restore пропускаем (см. skipPersist).
  useEffect(() => {
    if (result || step >= 2) return;
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    if (draftHasProgress(form, answers, step, sub)) {
      saveBriefDraft(draftKey, { scope: draftScope, form, answers, step, sub });
    } else {
      clearBriefDraft(draftKey);
    }
  }, [form, answers, step, sub, result, draftKey, draftScope]);

  // Фокус + скролл активного поля «о проекте» в зону видимости при смене вопроса
  // (на мобиле клавиатура не должна прятать поле/кнопку).
  useEffect(() => {
    if (step !== 0) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
    return () => clearTimeout(t);
  }, [step, sub]);

  const setField = (key: keyof Brief, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // current определён только на шаге «о проекте».
  const current = step === 0 ? PROJECT_ITEMS[sub] : null;
  const isLastProject = sub === PROJECT_TOTAL - 1;
  // Все пункты «о проекте» необязательны — двигаться вперёд можно всегда.
  const itemFilled = (it: ProjectItem) =>
    it.kind === "camera"
      ? Boolean(form.cameraExp)
      : String(form[it.key] ?? "").trim().length > 0;

  const isLastQuestion = sub === DISC_TOTAL - 1;

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
    const res = await onSubmit(brief);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Не удалось сохранить, попробуйте ещё раз");
      return;
    }
    clearBriefDraft(draftKey);
    setResult(disc);
    setStep(2);
  };

  const restart = () => {
    clearAdvance();
    clearBriefDraft(draftKey);
    setForm(initialBrief ? { ...EMPTY_BRIEF, ...initialBrief } : EMPTY_BRIEF);
    setAnswers(DISC_QUESTIONS.map(() => null));
    setResult(null);
    setError(null);
    setStep(0);
    setSub(0);
  };

  const profile = result ? DISC_PROFILES[result] : null;
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
          allowDeselect
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
          onFocus={(e) =>
            e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })
          }
          maxLength={BRIEF_LIMITS[current.key]}
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
        onFocus={(e) =>
          e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })
        }
        maxLength={BRIEF_LIMITS[current.key]}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            projectNext();
          }
        }}
      />
    );
  };

  // До чтения localStorage — лоадер (без вспышки первого вопроса при обновлении).
  if (!hydrated) {
    return (
      <Group justify="center" py={64}>
        <Loader color="brand" />
      </Group>
    );
  }

  return (
    <div>
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

      {/* ── Шаг 1: бриф о проекте, по одному вопросу (всё необязательно) ────── */}
      {step === 0 && current && (
        <Stack gap="lg">
          <div>
            <Title order={4}>{current.label}</Title>
            {current.hint ? (
              <Text size="sm" c="dimmed" mt={6}>
                {current.hint}
              </Text>
            ) : (
              <Text size="sm" c="dimmed" mt={6}>
                Необязательно — можно пропустить.
              </Text>
            )}
          </div>

          {renderProjectField()}

          <Group justify="space-between" mt="xs" wrap="nowrap">
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
              onClick={projectNext}
            >
              {isLastProject
                ? "Дальше — пара вопросов о тебе"
                : current && itemFilled(current)
                ? "Дальше"
                : "Пропустить"}
            </Button>
          </Group>
        </Stack>
      )}

      {/* ── Шаг 2: вопросы «о себе» (DISC), по одному (обязательно) ─────────── */}
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

          {/* Кнопки «Дальше» нет: после выбора варианта едем дальше сами
              (pickAnswer), на последнем вопросе — сразу финиш. Оставляем только
              «Назад» + индикацию сохранения результата. */}
          <Group justify="space-between" mt="xs" wrap="nowrap" mih={36}>
            <Button
              variant="subtle"
              color="gray"
              radius="md"
              leftSection={<IconArrowLeft size={16} />}
              onClick={goBack}
            >
              Назад
            </Button>
            {saving && (
              <Group gap="xs" wrap="nowrap">
                <Loader size="xs" color="brand" />
                <Text size="sm" c="dimmed">
                  Готовлю результат…
                </Text>
              </Group>
            )}
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
            <List
              size="sm"
              spacing={4}
              icon={
                <ThemeIcon color="brand" variant="light" size={18} radius="xl">
                  <IconCheck size={12} />
                </ThemeIcon>
              }
            >
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
          {resultNote}
          <Group justify="flex-end">{resultActions({ restart })}</Group>
        </Stack>
      )}
    </div>
  );
}
