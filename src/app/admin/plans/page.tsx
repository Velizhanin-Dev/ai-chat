"use client";

import { useEffect, useState } from "react";
import {
  Title,
  Text,
  Stack,
  Group,
  Paper,
  TextInput,
  NumberInput,
  Textarea,
  Switch,
  Button,
  Badge,
  Loader,
  Alert,
  SimpleGrid,
  Divider,
} from "@mantine/core";
import { IconCheck, IconAlertCircle, IconCurrencyRubel, IconPlus } from "@tabler/icons-react";
import { formatPrice, PLAN_ID_RE, type PublicPlan } from "@/lib/plans";

type Editable = PublicPlan & { _featuresText: string };

const EMPTY_NEW = { id: "", label: "", priceRub: 0, period: "в месяц" };

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Editable[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  // Форма нового тарифа (сворачиваемая).
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_NEW);

  useEffect(() => {
    fetch("/api/admin/plans", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { plans: PublicPlan[] }) =>
        setPlans(d.plans.map((p) => ({ ...p, _featuresText: p.features.join("\n") })))
      )
      .catch(() => setError("Не удалось загрузить тарифы"))
      .finally(() => setLoading(false));
  }, []);

  const update = (id: string, patch: Partial<Editable>) => {
    setPlans((ps) => ps?.map((p) => (p.id === id ? { ...p, ...patch } : p)) ?? ps);
    setSavedId(null);
  };
  const updateLimit = (id: string, key: keyof PublicPlan["limits"], value: number) => {
    setPlans(
      (ps) => ps?.map((p) => (p.id === id ? { ...p, limits: { ...p.limits, [key]: value } } : p)) ?? ps
    );
    setSavedId(null);
  };

  const save = async (p: Editable) => {
    setSavingId(p.id);
    setError(null);
    try {
      const patch = {
        label: p.label,
        priceRub: p.priceRub,
        period: p.period,
        features: p._featuresText.split("\n").map((s) => s.trim()).filter(Boolean),
        limits: p.limits,
        highlighted: p.highlighted,
        active: p.active,
      };
      const res = await fetch("/api/admin/plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, patch }),
      });
      const d = (await res.json()) as { plan?: PublicPlan; error?: string };
      if (!res.ok || !d.plan) throw new Error(d.error || "Ошибка");
      update(p.id, { ...d.plan, _featuresText: d.plan.features.join("\n") });
      setSavedId(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSavingId(null);
    }
  };

  const create = async () => {
    const id = draft.id.trim().toLowerCase();
    if (!PLAN_ID_RE.test(id)) {
      setError("id: латиница, цифры, дефис или подчёркивание, 2–31 символ (например blogger-2026)");
      return;
    }
    if (!draft.label.trim()) {
      setError("Укажите название тарифа");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          label: draft.label.trim(),
          priceRub: draft.priceRub,
          period: draft.period,
          features: [],
          limits: { requests: 0, projects: 0, instagram: 0, devices: 0, reports: 0 },
          active: false, // заводим скрытым: сперва настроить лимиты, потом показать
        }),
      });
      const d = (await res.json()) as { plan?: PublicPlan; error?: string };
      if (!res.ok || !d.plan) throw new Error(d.error || "Не удалось создать тариф");
      setPlans((ps) => [...(ps ?? []), { ...d.plan!, _featuresText: d.plan!.features.join("\n") }]);
      setDraft(EMPTY_NEW);
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать тариф");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Title order={2}>Тарифы</Title>
          <Text c="dimmed" size="sm" mt={4}>
            Цены, описание и лимиты. Изменения сразу видны на лендинге и в биллинге.
            В лимитах <code>-1</code> — без лимита, <code>0</code> — не применимо.
            Выключенный тариф пропадает с витрин, но у тех, кто на нём сидит, продолжает
            работать до конца оплаченного срока.
          </Text>
        </div>
        <Button
          color="brand"
          radius="md"
          leftSection={<IconPlus size={16} />}
          onClick={() => setAdding((v) => !v)}
          style={{ flexShrink: 0 }}
        >
          Новый тариф
        </Button>
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}

      {adding && (
        <Paper withBorder radius="md" p="lg">
          <Title order={4} mb={4}>
            Новый тариф
          </Title>
          <Text c="dimmed" size="sm" mb="md">
            Создаётся выключенным — задайте лимиты и фичи, потом включите «Активен».
            <b> id менять нельзя</b>: он попадает в подписки и платежи.
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" mb="md">
            {/* ⚠️ Значение читаем СРАЗУ в обработчике, а не внутри updater-функции
                setDraft: к моменту ленивого вызова updater React уже обнуляет
                e.currentTarget, и страница падала на первом введённом символе. */}
            <TextInput
              label="id (латиницей)"
              placeholder="blogger-2026"
              value={draft.id}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setDraft((d) => ({ ...d, id: v }));
              }}
              maxLength={31}
            />
            <TextInput
              label="Название"
              placeholder="Базовый 2026"
              value={draft.label}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setDraft((d) => ({ ...d, label: v }));
              }}
              maxLength={80}
            />
            <NumberInput
              label="Цена, ₽"
              value={draft.priceRub}
              onChange={(v) => setDraft((d) => ({ ...d, priceRub: typeof v === "number" ? v : 0 }))}
              min={0}
              step={500}
              thousandSeparator=" "
              leftSection={<IconCurrencyRubel size={14} />}
            />
            <TextInput
              label="Период / подпись"
              value={draft.period}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setDraft((d) => ({ ...d, period: v }));
              }}
              maxLength={80}
            />
          </SimpleGrid>
          <Group justify="flex-end" gap="sm">
            <Button variant="subtle" color="gray" radius="md" onClick={() => setAdding(false)}>
              Отмена
            </Button>
            <Button color="brand" radius="md" onClick={create} loading={creating}>
              Создать
            </Button>
          </Group>
        </Paper>
      )}

      {loading || !plans ? (
        <Group justify="center" py={48}>
          <Loader color="brand" />
        </Group>
      ) : (
        plans.map((p) => (
          <Paper key={p.id} withBorder radius="md" p="lg">
            <Group justify="space-between" mb="md" wrap="nowrap">
              <Group gap="xs">
                <Title order={4}>{p.label || p.id}</Title>
                <Badge variant="default" radius="sm" size="sm">
                  id: {p.id}
                </Badge>
                {p.highlighted && (
                  <Badge color="brand" variant="light" radius="sm" size="sm">
                    популярный
                  </Badge>
                )}
                {!p.active && (
                  <Badge color="gray" variant="light" radius="sm" size="sm">
                    архивный — скрыт с витрин
                  </Badge>
                )}
              </Group>
              <Text fw={600} c="brand">
                {formatPrice(p.priceRub)}
              </Text>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" mb="md">
              <TextInput
                label="Название"
                value={p.label}
                onChange={(e) => update(p.id, { label: e.currentTarget.value })}
                maxLength={80}
              />
              <NumberInput
                label="Цена, ₽"
                value={p.priceRub}
                onChange={(v) => update(p.id, { priceRub: typeof v === "number" ? v : 0 })}
                min={0}
                step={500}
                thousandSeparator=" "
                leftSection={<IconCurrencyRubel size={14} />}
              />
              <TextInput
                label="Период / подпись"
                value={p.period}
                onChange={(e) => update(p.id, { period: e.currentTarget.value })}
                maxLength={80}
              />
              <Group gap="lg" align="center" mt={{ base: 0, sm: 24 }}>
                <Switch
                  label="Популярный"
                  color="brand"
                  checked={p.highlighted}
                  onChange={(e) => update(p.id, { highlighted: e.currentTarget.checked })}
                />
                <Switch
                  label="Активен"
                  description="Выкл. — тариф исчезает с витрин, но действующие подписки на него работают"
                  color="brand"
                  checked={p.active}
                  onChange={(e) => update(p.id, { active: e.currentTarget.checked })}
                />
              </Group>
            </SimpleGrid>

            <Textarea
              label="Фичи (по одной в строке)"
              description="Буллеты, как они показываются на карточке тарифа."
              value={p._featuresText}
              onChange={(e) => update(p.id, { _featuresText: e.currentTarget.value })}
              autosize
              minRows={3}
              maxRows={8}
              mb="md"
            />

            <Divider label="Лимиты" labelPosition="left" mb="sm" />
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" mb="md">
              <NumberInput
                label="Запросы"
                value={p.limits.requests}
                onChange={(v) => updateLimit(p.id, "requests", typeof v === "number" ? v : 0)}
                min={-1}
                description={p.limits.requests === -1 ? "без лимита" : undefined}
              />
              <NumberInput
                label="Проекты"
                value={p.limits.projects}
                onChange={(v) => updateLimit(p.id, "projects", typeof v === "number" ? v : 0)}
                min={-1}
                description={p.limits.projects === -1 ? "без лимита" : undefined}
              />
              <NumberInput
                label="Instagram-аккаунты"
                value={p.limits.instagram}
                onChange={(v) => updateLimit(p.id, "instagram", typeof v === "number" ? v : 0)}
                min={-1}
                description={
                  p.limits.instagram === -1
                    ? "без лимита"
                    : p.limits.instagram === 0
                      ? "Instagram на тарифе недоступен"
                      : "проектов на Instagram"
                }
              />
              <NumberInput
                label="Устройства"
                value={p.limits.devices}
                onChange={(v) => updateLimit(p.id, "devices", typeof v === "number" ? v : 0)}
                min={-1}
                description={
                  p.limits.devices <= 0
                    ? "без лимита"
                    : "одновременных входов на аккаунт"
                }
              />
            </SimpleGrid>

            {/* ⚠️ Не число, а рубильник: отчёт по каналу для клиента — функция
                продюсерских тарифов, а не счётчик чего-либо. */}
            <Switch
              checked={p.limits.reports > 0}
              onChange={(e) => updateLimit(p.id, "reports", e.currentTarget.checked ? 1 : 0)}
              color="brand"
              label="PDF-отчёт по каналу для клиента"
              description="Кнопка «Отчёт для клиента» в разделе «Канал». Нужна продюсерам и агентствам, автору-одиночке — нет."
            />

            <Group justify="flex-end" gap="sm">
              {savedId === p.id && savingId !== p.id && (
                <Group gap={6} c="teal">
                  <IconCheck size={18} />
                  <Text size="sm">Сохранено</Text>
                </Group>
              )}
              <Button color="brand" radius="md" onClick={() => save(p)} loading={savingId === p.id}>
                Сохранить
              </Button>
            </Group>
          </Paper>
        ))
      )}
    </Stack>
  );
}
