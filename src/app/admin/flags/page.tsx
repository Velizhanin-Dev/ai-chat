"use client";

import { useEffect, useState } from "react";
import {
  Title,
  Text,
  Stack,
  Paper,
  Group,
  Switch,
  Button,
  Alert,
  Loader,
  Input,
  ThemeIcon,
  Badge,
  SegmentedControl,
  Select,
} from "@mantine/core";
import {
  IconClipboardText,
  IconRocket,
  IconCheck,
  IconAlertCircle,
  IconCpu,
} from "@tabler/icons-react";
import type { AppSettings } from "@/lib/settings";

// ISO (UTC) → значение для <input type="datetime-local"> (локальное время).
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function AdminFlagsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Каталог моделей OpenRouter — тянем только когда выбран этот провайдер.
  const [orModels, setOrModels] = useState<{ id: string; name: string }[]>([]);
  const [orModelsLoading, setOrModelsLoading] = useState(false);
  const [orModelsError, setOrModelsError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/settings", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { settings: AppSettings };
        setSettings(data.settings);
      } catch {
        setError("Не удалось загрузить настройки");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Загружаем каталог моделей OpenRouter при выборе провайдера (один раз).
  useEffect(() => {
    if (settings?.provider !== "openrouter" || orModels.length || orModelsLoading) return;
    setOrModelsLoading(true);
    setOrModelsError(null);
    void (async () => {
      try {
        const res = await fetch("/api/admin/openrouter/models", { cache: "no-store" });
        const data = (await res.json()) as {
          models?: { id: string; name: string }[];
          error?: string;
        };
        if (!res.ok || !data.models) throw new Error(data.error || "Ошибка");
        setOrModels(data.models);
      } catch (e) {
        setOrModelsError(e instanceof Error ? e.message : "Не удалось загрузить модели");
      } finally {
        setOrModelsLoading(false);
      }
    })();
  }, [settings?.provider, orModels.length, orModelsLoading]);

  const patch = (p: Partial<AppSettings>) => {
    setSettings((s) => (s ? { ...s, ...p } : s));
    setSaved(false);
  };
  const patchLaunch = (p: Partial<AppSettings["launch"]>) => {
    setSettings((s) => (s ? { ...s, launch: { ...s.launch, ...p } } : s));
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const data = (await res.json()) as { settings?: AppSettings; error?: string };
      if (!res.ok || !data.settings) throw new Error(data.error || "Ошибка");
      setSettings(data.settings);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Флаги и настройки</Title>
        <Text c="dimmed" size="sm" mt={4}>
          Включай и выключай фичи на лету — без редеплоя.
        </Text>
      </div>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}

      {loading || !settings ? (
        <Group justify="center" py={48}>
          <Loader color="brand" />
        </Group>
      ) : (
        <>
          {/* Страница брифа */}
          <Paper withBorder radius="md" p="lg">
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Group gap="sm" wrap="nowrap" align="flex-start">
                <ThemeIcon color="brand" variant="light" radius="md" size="lg">
                  <IconClipboardText size={18} />
                </ThemeIcon>
                <div>
                  <Text fw={600}>Страница брифа по QR</Text>
                  <Text size="sm" c="dimmed">
                    Анонимный бриф на <code>/brief</code>. Выкл → страница отдаёт 404.
                  </Text>
                </div>
              </Group>
              <Switch
                size="lg"
                color="brand"
                checked={settings.briefPageEnabled}
                onChange={(e) => patch({ briefPageEnabled: e.currentTarget.checked })}
              />
            </Group>
          </Paper>

          {/* Движок модели — глобально для всех пользователей */}
          <Paper withBorder radius="md" p="lg">
            <Group justify="space-between" wrap="nowrap" align="flex-start" mb={settings.provider === "openrouter" ? "md" : 0}>
              <Group gap="sm" wrap="nowrap" align="flex-start">
                <ThemeIcon color="brand" variant="light" radius="md" size="lg">
                  <IconCpu size={18} />
                </ThemeIcon>
                <div>
                  <Text fw={600}>Движок модели</Text>
                  <Text size="sm" c="dimmed">
                    Какой моделью отвечать всем пользователям — и генерировать
                    заголовки диалогов. Применяется глобально, без редеплоя.
                  </Text>
                </div>
              </Group>
              <SegmentedControl
                color="brand"
                radius="md"
                value={settings.provider}
                onChange={(v) => patch({ provider: v as AppSettings["provider"] })}
                data={[
                  { label: "Claude", value: "claude" },
                  { label: "GLM", value: "glm" },
                  { label: "OpenRouter", value: "openrouter" },
                ]}
              />
            </Group>

            {/* OpenRouter: выбор модели + режим промпта */}
            {settings.provider === "openrouter" && (
              <Stack gap="md" pl={{ base: 0, sm: 52 }}>
                <Select
                  label="Модель OpenRouter"
                  description="Каталог из openrouter.ai. Для DeepSeek выбери его модель и режим «Полный промпт»."
                  placeholder={orModelsLoading ? "Загружаю каталог…" : "Выбери модель"}
                  searchable
                  nothingFoundMessage="Ничего не найдено"
                  disabled={orModelsLoading}
                  error={orModelsError}
                  value={settings.openrouterModel || null}
                  onChange={(v) => patch({ openrouterModel: v ?? "" })}
                  data={(() => {
                    const opts = orModels.map((m) => ({ value: m.id, label: m.name }));
                    // Текущая модель может отсутствовать в каталоге (или он ещё не загружен) —
                    // добавим её, чтобы значение не «слетело».
                    if (
                      settings.openrouterModel &&
                      !opts.some((o) => o.value === settings.openrouterModel)
                    ) {
                      opts.unshift({
                        value: settings.openrouterModel,
                        label: settings.openrouterModel,
                      });
                    }
                    return opts;
                  })()}
                />

                <div>
                  <Text fw={500} size="sm" mb={4}>
                    Режим промпта
                  </Text>
                  <SegmentedControl
                    color="brand"
                    radius="md"
                    value={settings.routing}
                    onChange={(v) => patch({ routing: v as AppSettings["routing"] })}
                    data={[
                      { label: "Умный роутинг", value: "smart" },
                      { label: "Полный промпт", value: "full" },
                    ]}
                  />
                  <Text size="xs" c="dimmed" mt={6}>
                    <b>Умный роутинг</b> — подгружаем только релевантные куски базы (дешевле).{" "}
                    <b>Полный промпт</b> — отдаём всю базу знаний целиком: для моделей с
                    кэшированием контекста (DeepSeek), которым нужна вся информация сразу.
                  </Text>
                </div>
              </Stack>
            )}
          </Paper>

          {/* Режим «скоро запуск» */}
          <Paper withBorder radius="md" p="lg">
            <Group justify="space-between" wrap="nowrap" align="flex-start" mb="md">
              <Group gap="sm" wrap="nowrap" align="flex-start">
                <ThemeIcon color="brand" variant="light" radius="md" size="lg">
                  <IconRocket size={18} />
                </ThemeIcon>
                <div>
                  <Text fw={600}>
                    Таймер запуска{" "}
                    <Badge color="brand" variant="light" size="sm" radius="sm">
                      pre-launch
                    </Badge>
                  </Text>
                  <Text size="sm" c="dimmed">
                    При включении на лендинге скрываются тарифы, а в герое
                    показывается анимированный отсчёт до даты запуска.
                  </Text>
                </div>
              </Group>
              <Switch
                size="lg"
                color="brand"
                checked={settings.launch.countdownEnabled}
                onChange={(e) => patchLaunch({ countdownEnabled: e.currentTarget.checked })}
              />
            </Group>

            <Input.Wrapper
              label="Дата и время запуска"
              description="Локальное время. К нему идёт обратный отсчёт."
            >
              <Input
                type="datetime-local"
                value={isoToLocalInput(settings.launch.targetAt)}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  patchLaunch({ targetAt: v ? new Date(v).toISOString() : null });
                }}
                disabled={!settings.launch.countdownEnabled}
              />
            </Input.Wrapper>
          </Paper>

          <Group justify="flex-end">
            {saved && !saving && (
              <Group gap={6} c="teal">
                <IconCheck size={18} />
                <Text size="sm">Сохранено</Text>
              </Group>
            )}
            <Button color="brand" radius="md" onClick={save} loading={saving}>
              Сохранить
            </Button>
          </Group>
        </>
      )}
    </Stack>
  );
}
