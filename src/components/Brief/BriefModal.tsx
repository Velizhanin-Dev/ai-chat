"use client";

import { useEffect, useMemo, useState } from "react";
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
  ScrollArea,
} from "@mantine/core";
import {
  IconClipboardText,
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

// Текстовые поля брифа (шаг 1) — лаконичный набор, только то, что реально
// использует модель. Метки/плейсхолдеры держим в одном месте.
const FIELDS: {
  key: keyof Pick<
    Brief,
    "channel" | "niche" | "product" | "audience" | "expertise" | "goal" | "forbidden"
  >;
  label: string;
  placeholder: string;
  required?: boolean;
  area?: boolean;
}[] = [
  {
    key: "channel",
    label: "Канал / проект",
    placeholder: "Название канала или бренда",
    required: true,
  },
  {
    key: "niche",
    label: "Ниша — чем занимаешься",
    placeholder: "Например: онлайн-школа английского, барбершоп, B2B-разработка",
    required: true,
  },
  {
    key: "product",
    label: "Что продвигаешь через YouTube",
    placeholder: "Продукт/услуга, которую хочешь продавать через контент",
    required: true,
    area: true,
  },
  {
    key: "audience",
    label: "Кто твоя аудитория",
    placeholder: "Кто смотрит и покупает: пол, возраст, чем живут, что болит",
    required: true,
    area: true,
  },
  {
    key: "expertise",
    label: "Твоя экспертность как спикера",
    placeholder: "В чём ты реально силён, о чём можешь говорить часами",
    required: true,
    area: true,
  },
  {
    key: "goal",
    label: "Зачем тебе YouTube",
    placeholder: "Цель: продажи, лиды, личный бренд, охваты…",
    required: true,
  },
  {
    key: "forbidden",
    label: "Запретные темы (необязательно)",
    placeholder: "О чём говорить нельзя — политика, конкуренты, личное…",
  },
];

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

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Brief>(EMPTY_BRIEF);
  // Ответы DISC: индекс выбранной опции на каждый вопрос (или null).
  const [answers, setAnswers] = useState<(number | null)[]>(
    () => DISC_QUESTIONS.map(() => null)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiscType | null>(null);

  // При открытии — подхватываем уже сохранённый бриф (для «пройти заново») и
  // сбрасываем тест/шаги. Зависим от opened, чтобы каждое открытие было чистым.
  useEffect(() => {
    if (!opened) return;
    setForm(user?.brief ?? EMPTY_BRIEF);
    setAnswers(DISC_QUESTIONS.map(() => null));
    setStep(0);
    setError(null);
    setResult(null);
  }, [opened, user?.brief]);

  const setField = (key: keyof Brief, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const step1Valid = useMemo(
    () =>
      FIELDS.filter((f) => f.required).every(
        (f) => String(form[f.key] ?? "").trim().length > 0
      ) && Boolean(form.cameraExp),
    [form]
  );

  const allAnswered = answers.every((a) => a !== null);

  const handleFinish = async () => {
    if (!allAnswered) return;
    const axes: DiscAxis[] = answers.map(
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
    dispatch(authenticated(res.data.user));
    setResult(disc);
    setStep(2);
  };

  const profile = result ? DISC_PROFILES[result] : null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
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
            {result ? "Готово!" : "Бриф перед стартом"}
          </Text>
        </Group>
      }
    >
      <Stepper
        active={step}
        onStepClick={(s) => {
          // Назад ходить можно; вперёд — только если шаг валиден.
          if (result) return;
          if (s < step) setStep(s);
        }}
        color="brand"
        size="sm"
        mb="md"
        allowNextStepsSelect={false}
      >
        <Stepper.Step label="О проекте" icon={<IconClipboardText size={16} />} />
        <Stepper.Step label="Тип харизмы" icon={<IconSparkles size={16} />} />
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

      {/* ── Шаг 1: бриф о проекте ───────────────────────────────────────── */}
      {step === 0 && (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Пара минут — и я буду понимать твой проект и подавать контент под тебя.
            Чем честнее ответишь, тем точнее будут идеи и сценарии.
          </Text>
          {FIELDS.map((f) =>
            f.area ? (
              <Textarea
                key={f.key}
                label={f.label}
                placeholder={f.placeholder}
                value={String(form[f.key] ?? "")}
                onChange={(e) => setField(f.key, e.currentTarget.value)}
                withAsterisk={f.required}
                autosize
                minRows={2}
                maxRows={5}
              />
            ) : (
              <TextInput
                key={f.key}
                label={f.label}
                placeholder={f.placeholder}
                value={String(form[f.key] ?? "")}
                onChange={(e) => setField(f.key, e.currentTarget.value)}
                withAsterisk={f.required}
              />
            )
          )}
          <Select
            label="Опыт на камере"
            placeholder="Выбери вариант"
            withAsterisk
            value={form.cameraExp || null}
            onChange={(v) => setField("cameraExp", v ?? "")}
            data={CAMERA_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            allowDeselect={false}
          />

          <Group justify="flex-end" mt="sm">
            <Button
              color="brand"
              radius="md"
              rightSection={<IconArrowRight size={16} />}
              disabled={!step1Valid}
              onClick={() => setStep(1)}
            >
              Дальше — тест харизмы
            </Button>
          </Group>
        </Stack>
      )}

      {/* ── Шаг 2: DISC-тест ────────────────────────────────────────────── */}
      {step === 1 && (
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Короткий тест на тип харизмы (DISC). В каждом вопросе выбери, что
            ближе всего к тебе. По нему я пойму, какие форматы и подача тебе зайдут.
          </Text>
          <ScrollArea.Autosize mah={380} type="auto" offsetScrollbars>
            <Stack gap="lg" pr="sm">
              {DISC_QUESTIONS.map((question, qi) => (
                <Radio.Group
                  key={qi}
                  label={
                    <Text fw={500} component="span">
                      {qi + 1}. {question.q}
                    </Text>
                  }
                  value={answers[qi] === null ? "" : String(answers[qi])}
                  onChange={(v) =>
                    setAnswers((prev) => {
                      const next = [...prev];
                      next[qi] = Number(v);
                      return next;
                    })
                  }
                >
                  <Stack gap={6} mt={6}>
                    {question.options.map((opt, oi) => (
                      <Radio
                        key={oi}
                        value={String(oi)}
                        label={opt.label}
                        color="brand"
                      />
                    ))}
                  </Stack>
                </Radio.Group>
              ))}
            </Stack>
          </ScrollArea.Autosize>

          <Group justify="space-between" mt="sm">
            <Button
              variant="subtle"
              color="gray"
              radius="md"
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => setStep(0)}
            >
              Назад
            </Button>
            <Button
              color="brand"
              radius="md"
              rightSection={<IconCheck size={16} />}
              disabled={!allAnswered}
              loading={saving}
              onClick={handleFinish}
            >
              Завершить бриф
            </Button>
          </Group>
        </Stack>
      )}

      {/* ── Шаг 3: результат ────────────────────────────────────────────── */}
      {step === 2 && profile && (
        <Stack gap="md">
          <Paper withBorder radius="md" p="md">
            <Group gap="xs" mb="xs">
              <ThemeIcon color="brand" variant="light" radius="xl" size="lg">
                <IconSparkles size={18} />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed">
                  Твой тип харизмы
                </Text>
                <Title order={4}>
                  «{profile.nick}» <Text span c="dimmed" fz="sm">({profile.code})</Text>
                </Title>
              </div>
            </Group>
            <Text size="sm" mb="sm">
              {profile.character}
            </Text>
            <List size="sm" spacing={4}>
              <List.Item>
                <Text span fw={500}>Форматы под тебя:</Text> {profile.formats}
              </List.Item>
              <List.Item>
                <Text span fw={500}>Что тебя заводит:</Text> {profile.works}
              </List.Item>
            </List>
          </Paper>
          <Text size="sm" c="dimmed">
            Готово — бриф сохранён, я буду это учитывать в каждом ответе. Поменять
            можно в любой момент в настройках, кнопка «Пройти бриф заново».
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
