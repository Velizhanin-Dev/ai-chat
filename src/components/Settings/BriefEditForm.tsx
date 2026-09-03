"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconRefresh } from "@tabler/icons-react";
import {
  BRIEF_LIMITS,
  CAMERA_OPTIONS,
  DISC_PROFILES,
  type Brief,
  type CameraExp,
  type DiscType,
} from "@/lib/brief";

// Правка брифа СУЩЕСТВУЮЩЕГО проекта — анкета, а не визард.
//
// ⚠️ Визард «по одному вопросу на экран» (BriefFlow) остаётся для СОЗДАНИЯ проекта:
// там человек отвечает впервые и по одному вопросу ему легче. Здесь другая задача —
// поправить два слова в уже заполненном брифе, и гонять ради этого через восемь
// экранов и тест личности нельзя (правка владельца, 2026-09-03). Все поля видны
// разом, одна кнопка «Сохранить». Тип личности — селектом; пройти тест заново
// можно отдельной кнопкой (родитель открывает визард).

type TextKey = keyof typeof BRIEF_LIMITS;

const FIELDS: { key: TextKey; label: string; placeholder: string; area?: boolean }[] = [
  { key: "channel", label: "Канал или проект", placeholder: "Название канала или бренда" },
  {
    key: "niche",
    label: "Чем занимаешься",
    placeholder: "Например: онлайн-школа английского, барбершоп, B2B-разработка",
  },
  {
    key: "product",
    label: "Что продвигаешь через YouTube",
    placeholder: "Продукт или услуга, которую хочешь продавать через контент",
    area: true,
  },
  {
    key: "audience",
    label: "Аудитория",
    placeholder: "Кто смотрит и покупает: пол, возраст, чем живут, что болит",
    area: true,
  },
  {
    key: "expertise",
    label: "В чём силён как спикер",
    placeholder: "О чём можешь говорить часами, где ты реально эксперт",
    area: true,
  },
  { key: "goal", label: "Зачем YouTube", placeholder: "Продажи, лиды, личный бренд, охваты…" },
  {
    key: "forbidden",
    label: "Запретные темы",
    placeholder: "О чём говорить нельзя — политика, конкуренты, личное…",
  },
];

const DISC_OPTIONS = Object.values(DISC_PROFILES).map((p) => ({
  value: p.code,
  label: `«${p.nick}» · ${p.code}`,
}));

export default function BriefEditForm({
  initial,
  onSave,
  onCancel,
  onRetakeTest,
}: {
  initial: Brief;
  onSave: (b: Brief) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
  /** Открыть визард с тестом типа личности (BriefFlow) вместо селекта. */
  onRetakeTest: () => void;
}) {
  const [form, setForm] = useState<Brief>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof Brief>(key: K, val: Brief[K]) => {
    setSaved(false);
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const submit = async () => {
    if (!form.disc) {
      setError("Выбери тип личности — без него ассистент не знает, как писать под тебя");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await onSave(form);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Не удалось сохранить");
      return;
    }
    setSaved(true);
  };

  return (
    <Stack gap="md">
      {FIELDS.map((f) =>
        f.area ? (
          <Textarea
            key={f.key}
            label={f.label}
            placeholder={f.placeholder}
            autosize
            minRows={2}
            maxLength={BRIEF_LIMITS[f.key]}
            value={form[f.key]}
            onChange={(e) => set(f.key, e.currentTarget.value)}
          />
        ) : (
          <TextInput
            key={f.key}
            label={f.label}
            placeholder={f.placeholder}
            maxLength={BRIEF_LIMITS[f.key]}
            value={form[f.key]}
            onChange={(e) => set(f.key, e.currentTarget.value)}
          />
        )
      )}

      <Select
        label="Опыт на камере"
        placeholder="Не указан"
        data={CAMERA_OPTIONS}
        value={form.cameraExp || null}
        onChange={(v) => set("cameraExp", (v ?? "") as CameraExp)}
        clearable
        comboboxProps={{ withinPortal: true }}
      />

      <Box>
        <Select
          label="Тип личности"
          placeholder="Выбери тип"
          data={DISC_OPTIONS}
          value={form.disc}
          // Ручной выбор — тип точный, пометка «смешанный» от прошлого теста снимается.
          onChange={(v) => {
            set("disc", (v as DiscType | null) ?? null);
            set("isMixed", false);
          }}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
        <Button
          variant="subtle"
          color="gray"
          size="compact-xs"
          mt={6}
          leftSection={<IconRefresh size={13} />}
          onClick={onRetakeTest}
        >
          Не уверен — пройти тест заново
        </Button>
      </Box>

      {error && (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}
      {saved && (
        <Alert color="teal" variant="light" icon={<IconCheck size={16} />}>
          Сохранено. Профиль проекта пересобирается в фоне — со следующего сообщения
          ассистент будет отвечать по новым данным.
        </Alert>
      )}

      <Group justify="flex-end" gap="sm">
        <Button variant="default" onClick={onCancel} disabled={saving}>
          {saved ? "Закрыть" : "Отмена"}
        </Button>
        <Button color="brand" onClick={() => void submit()} loading={saving}>
          Сохранить
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Поля можно оставить пустыми, обязателен только тип личности.
      </Text>
    </Stack>
  );
}
