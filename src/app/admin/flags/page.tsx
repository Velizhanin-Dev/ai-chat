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
  Box,
  Divider,
  NumberInput,
  SimpleGrid,
} from "@mantine/core";
import {
  IconClipboardText,
  IconRocket,
  IconCheck,
  IconAlertCircle,
  IconCpu,
  IconPhoto,
  IconHourglass,
} from "@tabler/icons-react";
import type { AppSettings } from "@/lib/settings";
import {
  OR_NUMERIC_PARAMS,
  OR_REASONING_KEY,
  OR_REASONING_EFFORTS,
  type OpenRouterParams,
} from "@/lib/llm/openrouter-params";

type OrModel = {
  id: string;
  name: string;
  context?: number;
  supportedParams?: string[];
};

type OrProvider = {
  slug: string;
  name: string;
  prompt: number;
  cacheRead: number | null;
  implicitCache: boolean;
};

// Цена за токен → строка «$X/M».
const perM = (v: number) => `$${(v * 1_000_000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}/M`;

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

  // Массовый сброс пробных периодов: сколько затронет / подтверждение / результат.
  const [trialInfo, setTrialInfo] = useState<{ count: number } | null>(null);
  const [trialConfirm, setTrialConfirm] = useState(false);
  const [trialBusy, setTrialBusy] = useState(false);
  const [trialDone, setTrialDone] = useState<number | null>(null);

  // Каталог моделей OpenRouter — тянем только когда выбран этот провайдер.
  const [orModels, setOrModels] = useState<OrModel[]>([]);
  const [orModelsLoading, setOrModelsLoading] = useState(false);
  const [orModelsError, setOrModelsError] = useState<string | null>(null);

  // Провайдеры выбранной модели (для пина под кэш) — тянем при смене модели.
  const [orProviders, setOrProviders] = useState<OrProvider[]>([]);
  const [orProvidersLoading, setOrProvidersLoading] = useState(false);

  // Каталог image-моделей (для генератора превью) — отдельный список, грузим
  // один раз при открытии страницы: он нужен независимо от движка чата.
  const [imgModels, setImgModels] = useState<OrModel[]>([]);
  const [imgModelsLoading, setImgModelsLoading] = useState(false);
  const [imgModelsError, setImgModelsError] = useState<string | null>(null);

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
          models?: OrModel[];
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

  // Каталог моделей, которые ОТДАЮТ картинки (для селектора превью).
  useEffect(() => {
    setImgModelsLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/admin/openrouter/models?output=image", {
          cache: "no-store",
        });
        const data = (await res.json()) as { models?: OrModel[]; error?: string };
        if (!res.ok || !data.models) throw new Error(data.error || "Ошибка");
        setImgModels(data.models);
      } catch (e) {
        setImgModelsError(
          e instanceof Error ? e.message : "Не удалось загрузить список image-моделей"
        );
      } finally {
        setImgModelsLoading(false);
      }
    })();
  }, []);

  // Провайдеры конкретной модели — перезагружаем при смене модели.
  const orModel = settings?.provider === "openrouter" ? settings.openrouterModel : "";
  useEffect(() => {
    if (!orModel) {
      setOrProviders([]);
      return;
    }
    let cancelled = false;
    setOrProvidersLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/openrouter/providers?model=${encodeURIComponent(orModel)}`,
          { cache: "no-store" }
        );
        const data = (await res.json()) as { providers?: OrProvider[] };
        if (!cancelled) setOrProviders(res.ok && data.providers ? data.providers : []);
      } catch {
        if (!cancelled) setOrProviders([]);
      } finally {
        if (!cancelled) setOrProvidersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orModel]);

  const patch = (p: Partial<AppSettings>) => {
    setSettings((s) => (s ? { ...s, ...p } : s));
    setSaved(false);
  };
  const patchLaunch = (p: Partial<AppSettings["launch"]>) => {
    setSettings((s) => (s ? { ...s, launch: { ...s.launch, ...p } } : s));
    setSaved(false);
  };
  // Правка одного параметра генерации OpenRouter. undefined = снять значение.
  const patchParam = (key: keyof OpenRouterParams, value: number | string | undefined) => {
    setSettings((s) => {
      if (!s) return s;
      const next = { ...s.openrouterParams };
      if (value === undefined || value === "") delete next[key];
      else (next as Record<string, unknown>)[key] = value;
      return { ...s, openrouterParams: next };
    });
    setSaved(false);
  };

  // Что поддерживает выбранная модель (из каталога). Пока каталог не загружен —
  // показываем все крутилки (не блокируем правку), а список параметров модели
  // просто ещё не известен.
  const selectedModel = orModels.find((m) => m.id === settings?.openrouterModel);
  const supported = selectedModel?.supportedParams ?? null;
  const isSupported = (key: string) => !supported || supported.includes(key);

  // Сколько пользователей затронет сброс — показываем ДО подтверждения, чтобы
  // админ видел масштаб, а не жал вслепую.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/trial-reset", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        setTrialInfo({ count: data.count });
      } catch {
        /* не критично: кнопка работает и без счётчика */
      }
    })();
  }, []);

  const resetTrials = async () => {
    setTrialBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/trial-reset", { method: "POST" });
      const data = (await res.json()) as { count?: number; error?: string };
      if (!res.ok || data.count == null) throw new Error(data.error || "Ошибка");
      setTrialDone(data.count);
      setTrialConfirm(false);
      // Счётчик «затронет» после сброса тот же (люди остаются пробными) —
      // перезапрашивать нечего.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сбросить пробные периоды");
    } finally {
      setTrialBusy(false);
    }
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

          {/* Пробный период: срок + массовый сброс */}
          <Paper withBorder radius="md" p="lg">
            <Group gap="sm" wrap="nowrap" align="flex-start" mb="md">
              <ThemeIcon color="brand" variant="light" radius="md" size="lg">
                <IconHourglass size={18} />
              </ThemeIcon>
              <Box>
                <Text fw={600}>Пробный период</Text>
                <Text size="sm" c="dimmed">
                  Срок задаётся здесь, число запросов — в редакторе тарифов (лимит «Запросы» у
                  бесплатного тарифа). Это две разные ручки.
                </Text>
              </Box>
            </Group>

            <NumberInput
              maw={220}
              label="Длительность, часов"
              description="Выдаётся при регистрации и при сбросе ниже."
              min={1}
              max={168}
              value={settings.trialHours}
              onChange={(v) => {
                const n = Number(v);
                if (Number.isFinite(n)) patch({ trialHours: n });
              }}
            />

            <Divider my="md" />

            <Text fw={600} size="sm">
              Сбросить пробные периоды
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              Выдаёт пробный период заново всем, кто на бесплатном тарифе и ни разу не платил:
              срок с этой минуты и счётчик запросов в ноль. Тех, кто платил или сидит на платном
              тарифе, не трогает. Нужно перед рассылкой — человек приходит по письму, и у него
              снова есть доступ.
            </Text>

            {trialInfo && (
              <Text size="sm" mt="sm">
                Затронет пользователей: <b>{trialInfo.count}</b>
              </Text>
            )}
            {trialDone != null && (
              <Alert color="teal" mt="sm" variant="light">
                Пробный период выдан заново: {trialDone} чел.
              </Alert>
            )}

            <Group gap="sm" mt="sm">
              {!trialConfirm ? (
                <Button
                  variant="light"
                  color="brand"
                  onClick={() => setTrialConfirm(true)}
                  disabled={trialBusy}
                >
                  Сбросить пробные периоды
                </Button>
              ) : (
                <>
                  <Button color="red" loading={trialBusy} onClick={resetTrials}>
                    Да, сбросить {trialInfo ? `(${trialInfo.count})` : ""}
                  </Button>
                  <Button variant="subtle" color="gray" onClick={() => setTrialConfirm(false)}>
                    Отмена
                  </Button>
                </>
              )}
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

                {/* Пин провайдера — чтобы кэш DeepSeek грелся (иначе балансировка = 0% hit) */}
                <Select
                  label="Провайдер (пин для кэша)"
                  description="OpenRouter балансирует запросы между провайдерами — из-за этого пер-провайдерный кэш не срабатывает. Пин шлёт все запросы в одного (без фолбэков). Для кэша выбирай провайдера с implicit-кэшем и дешёвым cache read."
                  placeholder={orProvidersLoading ? "Загружаю…" : "Авто (балансировка)"}
                  disabled={!settings.openrouterModel}
                  clearable
                  searchable
                  value={settings.openrouterProvider || null}
                  onChange={(v) => patch({ openrouterProvider: v ?? "" })}
                  data={(() => {
                    const opts = orProviders.map((p) => ({
                      value: p.slug,
                      label: `${p.name} — вход ${perM(p.prompt)}${
                        p.cacheRead != null ? `, кэш ${perM(p.cacheRead)}` : ", без кэша"
                      }${p.implicitCache ? " ✓" : ""}`,
                    }));
                    // Текущий пин мог не оказаться в списке (каталог не загружен) — не терять.
                    if (
                      settings.openrouterProvider &&
                      !opts.some((o) => o.value === settings.openrouterProvider)
                    ) {
                      opts.unshift({
                        value: settings.openrouterProvider,
                        label: settings.openrouterProvider,
                      });
                    }
                    return opts;
                  })()}
                  maw={480}
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

                {/* Веб-поиск (плагин `web` OpenRouter). Платный отдельно от токенов. */}
                <div>
                  <Switch
                    color="brand"
                    label="Веб-поиск в чате"
                    description="Модель ищет в интернете перед ответом — свежая фактура и меньше выдумок по нише клиента. В чате показывается «Ищу в интернете»."
                    checked={settings.webSearch.enabled}
                    onChange={(e) =>
                      patch({
                        webSearch: {
                          ...settings.webSearch,
                          enabled: e.currentTarget.checked,
                        },
                      })
                    }
                  />
                  {settings.webSearch.enabled && (
                    <NumberInput
                      mt="sm"
                      maw={220}
                      label="Результатов на запрос"
                      description="Каждый результат ≈ $0.004 сверх токенов."
                      min={1}
                      max={5}
                      value={settings.webSearch.maxResults}
                      onChange={(v) => {
                        const n = Number(v);
                        if (!Number.isFinite(n)) return;
                        patch({
                          webSearch: { ...settings.webSearch, maxResults: n },
                        });
                      }}
                    />
                  )}
                  <Text size="xs" c="dimmed" mt={6}>
                    ⚠️ Платно <b>отдельно от токенов</b>: при 3 результатах это ≈ +$0,012 к
                    каждому запросу — сопоставимо со стоимостью самой генерации. Кэш промпта
                    поиск не ломает (выдача подмешивается после кэшируемого префикса), на
                    болтовню («привет», «спасибо») не тратится. Работает только на OpenRouter.
                  </Text>
                </div>

                {/* Параметры генерации выбранной модели (supported_parameters) */}
                <div>
                  <Text fw={500} size="sm" mb={2}>
                    Параметры генерации
                  </Text>
                  <Text size="xs" c="dimmed" mb="sm">
                    {settings.openrouterModel
                      ? supported
                        ? "Показаны только параметры, что поддерживает выбранная модель. Пустое поле — параметр не передаётся (значение по умолчанию модели)."
                        : "Каталог ещё грузится — список параметров модели уточнится. Пустое поле не передаётся."
                      : "Сначала выбери модель выше."}
                  </Text>

                  {settings.openrouterModel && (
                    <Stack gap="sm">
                      {/* Reasoning / thinking — если модель поддерживает */}
                      {isSupported(OR_REASONING_KEY) && (
                        <Select
                          label="Reasoning (thinking)"
                          description="Глубина рассуждений. «Выкл» — параметр не передаётся."
                          value={settings.openrouterParams.reasoning ?? ""}
                          onChange={(v) => patchParam("reasoning", v || undefined)}
                          data={[
                            { value: "", label: "Выкл (по умолчанию)" },
                            ...OR_REASONING_EFFORTS.map((e) => ({ value: e, label: e })),
                          ]}
                          allowDeselect={false}
                          maw={280}
                        />
                      )}

                      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
                        {OR_NUMERIC_PARAMS.filter((spec) => isSupported(spec.key)).map(
                          (spec) => (
                            <NumberInput
                              key={spec.key}
                              label={spec.label}
                              placeholder="—"
                              min={spec.min}
                              max={spec.max}
                              step={spec.step}
                              allowDecimal={!spec.int}
                              clampBehavior="strict"
                              value={settings.openrouterParams[spec.key] ?? ""}
                              onChange={(v) =>
                                patchParam(
                                  spec.key,
                                  v === "" || v === null ? undefined : Number(v)
                                )
                              }
                            />
                          )
                        )}
                      </SimpleGrid>

                      {supported &&
                        !isSupported(OR_REASONING_KEY) &&
                        OR_NUMERIC_PARAMS.every((s) => !isSupported(s.key)) && (
                          <Text size="xs" c="dimmed">
                            Эта модель не заявляет управляемых параметров генерации.
                          </Text>
                        )}
                    </Stack>
                  )}
                </div>
              </Stack>
            )}
          </Paper>

          {/* Модель генерации превью — всегда OpenRouter, независимо от движка чата */}
          <Paper withBorder radius="md" p="lg">
            <Group gap="sm" wrap="nowrap" align="flex-start" mb="md">
              <ThemeIcon color="brand" variant="light" radius="md" size="lg">
                <IconPhoto size={18} />
              </ThemeIcon>
              <div>
                <Text fw={600}>Модель генерации превью</Text>
                <Text size="sm" c="dimmed">
                  Раздел «Генератор превью» в проекте. Всегда идёт в OpenRouter —
                  независимо от движка чата выше. По умолчанию Nano Banana Pro
                  (<code>google/gemini-3-pro-image</code>): держит личность спикера с
                  референсов и нормально рендерит кириллицу на превью.
                </Text>
              </div>
            </Group>
            <Select
              label="Модель"
              placeholder={imgModelsLoading ? "Загружаю каталог…" : "google/gemini-3-pro-image"}
              searchable
              clearable
              nothingFoundMessage="Ничего не найдено"
              disabled={imgModelsLoading}
              value={settings.imageModel || null}
              onChange={(v) => patch({ imageModel: v ?? "" })}
              data={(() => {
                const opts = imgModels.map((m) => ({ value: m.id, label: m.name }));
                // Сохранённая модель могла исчезнуть из каталога — показываем как есть,
                // иначе Select молча покажет пусто и «съест» настройку при сохранении.
                if (settings.imageModel && !opts.some((o) => o.value === settings.imageModel)) {
                  opts.unshift({ value: settings.imageModel, label: settings.imageModel });
                }
                return opts;
              })()}
              description={
                imgModelsError
                  ? imgModelsError
                  : "Пусто — берётся дефолт из кода (Nano Banana Pro)."
              }
              error={imgModelsError ?? undefined}
            />
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
