"use client";

import { useEffect, useState } from "react";
import {
  Title,
  Text,
  Stack,
  Group,
  TextInput,
  Table,
  Badge,
  Pagination,
  Loader,
  Drawer,
  Paper,
  Image,
  Alert,
  Accordion,
  Select,
  Button,
  Divider,
} from "@mantine/core";
import {
  IconSearch,
  IconAlertCircle,
  IconMail,
  IconMailOff,
  IconTrash,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import { DISC_PROFILES, CAMERA_OPTIONS } from "@/lib/brief";
import { PLAN_LABEL, PLAN_ORDER, type PlanId } from "@/store/authSlice";
import { PlanBadge, PaymentStatusBadge, PaymentProviderBadge } from "@/components/Admin/Badges";
import { formatPrice } from "@/lib/plans";
import type { AdminUserRow } from "@/app/api/admin/users/route";
import type { AdminPaymentRow } from "@/app/api/admin/payments/route";
import type { AdminProjectRow } from "@/app/api/admin/users/[id]/projects/route";

// Квота запросов: "12 / 30" или "12 / ∞" (без лимита) или "12" (тариф не найден).
function quotaLabel(used: number, limit: number | null): string {
  if (limit == null) return String(used);
  if (limit < 0) return `${used} / ∞`;
  return `${used} / ${limit}`;
}

const cameraLabel = (v: string) =>
  CAMERA_OPTIONS.find((o) => o.value === v)?.label ?? "";

// Поля брифа «о проекте» для деталей (показываем только заполненные).
type BriefTextKey =
  | "channel"
  | "niche"
  | "product"
  | "audience"
  | "expertise"
  | "goal"
  | "forbidden";
const BRIEF_FIELDS: { key: BriefTextKey; label: string }[] = [
  { key: "channel", label: "Канал / проект" },
  { key: "niche", label: "Ниша" },
  { key: "product", label: "Продвигает" },
  { key: "audience", label: "Аудитория" },
  { key: "expertise", label: "Экспертность" },
  { key: "goal", label: "Цель" },
  { key: "forbidden", label: "Запретные темы" },
];

function planLabel(plan: string) {
  return PLAN_LABEL[plan as PlanId] ?? plan;
}

// Способ входа → человекочитаемая подпись.
const AUTH_LABEL: Record<string, string> = {
  email: "Email и пароль",
  vk: "VK ID",
  yandex: "Яндекс",
};
const authLabel = (m: string) => AUTH_LABEL[m] ?? m;

// Опции для Select тарифа/роли.
const PLAN_OPTIONS = PLAN_ORDER.map((id) => ({ value: id, label: PLAN_LABEL[id] }));
const ROLE_OPTIONS = [
  { value: "user", label: "Пользователь" },
  { value: "admin", label: "Администратор" },
];

// ISO → значение для <input type="datetime-local"> (в локальном времени).
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  // Фильтр по тарифу ("" = все). id из PLAN_ORDER.
  const [planFilter, setPlanFilter] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ users: AdminUserRow[]; total: number; pageSize: number } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  // История платежей выбранного юзера (грузим при открытии карточки).
  const [payments, setPayments] = useState<AdminPaymentRow[] | null>(null);
  // Проекты выбранного юзера с их брифами (бриф теперь у проекта, не у юзера).
  const [projects, setProjects] = useState<AdminProjectRow[] | null>(null);
  // Версия списка — бампаем после правок/удаления, чтобы перезагрузить таблицу.
  const [version, setVersion] = useState(0);

  // ── Управление выбранным юзером (роль / тариф / срок подписки / удаление) ──
  const [editRole, setEditRole] = useState("user");
  const [editPlan, setEditPlan] = useState("start");
  const [editExpires, setEditExpires] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Засеваем форму правки при выборе юзера.
  useEffect(() => {
    if (!selected) return;
    setEditRole(selected.role);
    setEditPlan(selected.plan);
    setEditExpires(toLocalInput(selected.planExpiresAt));
    setSaveErr(null);
    setSaved(false);
    setConfirmDelete(false);
  }, [selected]);

  const dirty =
    !!selected &&
    (editRole !== selected.role ||
      editPlan !== selected.plan ||
      editExpires !== toLocalInput(selected.planExpiresAt));

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    setSaveErr(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/users/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: editRole,
          plan: editPlan,
          planExpiresAt: editExpires ? new Date(editExpires).toISOString() : null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "Не удалось сохранить");
      setSelected(d.user);
      setSaved(true);
      setVersion((v) => v + 1);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  // Обнулить счётчик израсходованных запросов (дать свежую квоту в этом же тарифе).
  async function handleResetRequests() {
    if (!selected) return;
    setSaving(true);
    setSaveErr(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/users/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetRequests: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "Не удалось сбросить");
      setSelected(d.user);
      setVersion((v) => v + 1);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Не удалось сбросить");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    setDeleting(true);
    setSaveErr(null);
    try {
      const res = await fetch(`/api/admin/users/${selected.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "Не удалось удалить");
      setSelected(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Не удалось удалить");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!selected) {
      setPayments(null);
      setProjects(null);
      return;
    }
    let alive = true;
    setPayments(null);
    setProjects(null);
    const uid = encodeURIComponent(selected.id);
    fetch(`/api/admin/payments?userId=${uid}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { payments: AdminPaymentRow[] }) => alive && setPayments(d.payments))
      .catch(() => alive && setPayments([]));
    fetch(`/api/admin/users/${uid}/projects`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { projects: AdminProjectRow[] }) => alive && setProjects(d.projects))
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, [selected]);

  // Сброс на первую страницу при смене поиска или фильтра тарифа.
  useEffect(() => {
    setPage(1);
  }, [q, planFilter]);

  // Загрузка списка (дебаунс по поиску, чтобы не дёргать API на каждый символ).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ page: String(page) });
      if (q.trim()) params.set("q", q.trim());
      if (planFilter) params.set("plan", planFilter);
      fetch(`/api/admin/users?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          if (alive) {
            setData(d);
            setError(null);
          }
        })
        .catch(() => alive && setError("Не удалось загрузить пользователей"))
        .finally(() => alive && setLoading(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, planFilter, page, version]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Пользователи</Title>
        <Text c="dimmed" size="sm" mt={4}>
          {data ? `Всего: ${data.total}` : "Загрузка…"}
        </Text>
      </div>

      <Group align="flex-end" gap="sm" wrap="wrap">
        <TextInput
          label="Поиск"
          placeholder="Поиск по имени или почте"
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={{ base: "100%", xs: 320 }}
        />
        <Select
          label="Тариф"
          value={planFilter || null}
          onChange={(v) => setPlanFilter(v ?? "")}
          placeholder="Все тарифы"
          clearable
          data={PLAN_ORDER.map((id) => ({ value: id, label: PLAN_LABEL[id] }))}
          w={{ base: "100%", xs: 200 }}
        />
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}

      <Paper withBorder radius="md" pos="relative" mih={200}>
        {loading && (
          <Group
            justify="center"
            align="center"
            pos="absolute"
            inset={0}
            style={{ background: "var(--mantine-color-body)", opacity: 0.6, zIndex: 1 }}
          >
            <Loader color="brand" />
          </Group>
        )}
        <Table.ScrollContainer minWidth={640}>
          <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Пользователь</Table.Th>
                <Table.Th miw={120}>Тариф</Table.Th>
                <Table.Th>Проекты</Table.Th>
                <Table.Th>Запросы</Table.Th>
                <Table.Th>Регистрация</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data?.users.map((u) => {
                return (
                  <Table.Tr
                    key={u.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelected(u)}
                  >
                    <Table.Td>
                      <Text size="sm" fw={500} component="div">
                        {u.name}
                        {u.role === "admin" && (
                          <Badge ml="xs" size="xs" color="brand" variant="light" radius="sm">
                            admin
                          </Badge>
                        )}
                      </Text>
                      <Group gap={4} wrap="nowrap" c="dimmed">
                        {u.emailVerified ? (
                          <IconMail size={12} />
                        ) : (
                          <IconMailOff size={12} />
                        )}
                        <Text size="xs" c="dimmed">
                          {u.email}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <PlanBadge plan={u.plan} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{u.projectCount}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{quotaLabel(u.requestsUsed, u.requestsLimit)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {new Date(u.createdAt).toLocaleDateString("ru-RU")}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {data && data.users.length === 0 && !loading && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text ta="center" c="dimmed" py="lg">
                      Никого не найдено
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      {totalPages > 1 && (
        <Group justify="center">
          <Pagination total={totalPages} value={page} onChange={setPage} color="brand" />
        </Group>
      )}

      {/* Детали пользователя + полный бриф */}
      <Drawer
        opened={!!selected}
        onClose={() => setSelected(null)}
        position="right"
        size="md"
        title={
          <Text fw={600} fz="lg">
            {selected?.name}
          </Text>
        }
      >
        {selected && (
          <Stack gap="md">
            {/* Основная информация — обычной карточкой, без сворачивания */}
            <Paper withBorder radius="md" p="md">
              <Stack gap="sm">
                <div>
                  <Text size="xs" c="dimmed">
                    Имя
                  </Text>
                  <Text size="sm">{selected.name}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Почта
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    {selected.emailVerified ? (
                      <IconMail size={14} />
                    ) : (
                      <IconMailOff size={14} />
                    )}
                    <Text size="sm">{selected.email}</Text>
                    <Text size="xs" c="dimmed">
                      {selected.emailVerified ? "(подтверждена)" : "(не подтверждена)"}
                    </Text>
                  </Group>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Способ входа
                  </Text>
                  <Text size="sm">
                    {selected.authMethods.length
                      ? selected.authMethods.map(authLabel).join(", ")
                      : "—"}
                  </Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Тариф
                  </Text>
                  <Text size="sm">{planLabel(selected.plan)}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Подписка активна до
                  </Text>
                  <Text size="sm">
                    {selected.planExpiresAt
                      ? new Date(selected.planExpiresAt).toLocaleString("ru-RU")
                      : "—"}
                  </Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Запросы (израсходовано / лимит)
                  </Text>
                  <Text size="sm">
                    {quotaLabel(selected.requestsUsed, selected.requestsLimit)}
                    {selected.requestsLimit != null && selected.requestsLimit >= 0 && (
                      <Text span c="dimmed" size="xs">
                        {"  ·  осталось "}
                        {Math.max(0, selected.requestsLimit - selected.requestsUsed)}
                      </Text>
                    )}
                  </Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Проектов
                  </Text>
                  <Text size="sm">{selected.projectCount}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Роль
                  </Text>
                  <Text size="sm">
                    {selected.role === "admin" ? "Администратор" : "Пользователь"}
                  </Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Регистрация
                  </Text>
                  <Text size="sm">{new Date(selected.createdAt).toLocaleString("ru-RU")}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Последний визит
                  </Text>
                  <Text size="sm">
                    {selected.lastSeenAt
                      ? new Date(selected.lastSeenAt).toLocaleString("ru-RU")
                      : "—"}
                  </Text>
                </div>
              </Stack>
            </Paper>

            {/* Управление: роль / тариф / срок подписки + удаление */}
            <Paper withBorder radius="md" p="md">
              <Text fw={600} size="sm" mb="sm">
                Управление
              </Text>
              <Stack gap="sm">
                <Select
                  label="Роль"
                  data={ROLE_OPTIONS}
                  value={editRole}
                  onChange={(v) => v && setEditRole(v)}
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: false }}
                />
                <Select
                  label="Тариф"
                  data={PLAN_OPTIONS}
                  value={editPlan}
                  onChange={(v) => v && setEditPlan(v)}
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: false }}
                />
                <TextInput
                  label="Подписка активна до"
                  type="datetime-local"
                  value={editExpires}
                  onChange={(e) => setEditExpires(e.currentTarget.value)}
                  description="Пусто = без платной подписки"
                  rightSection={
                    editExpires ? (
                      <Text
                        component="button"
                        type="button"
                        c="dimmed"
                        fz="xs"
                        onClick={() => setEditExpires("")}
                        style={{ cursor: "pointer", background: "none", border: 0 }}
                      >
                        очистить
                      </Text>
                    ) : null
                  }
                  rightSectionWidth={64}
                />

                {saveErr && (
                  <Alert color="red" icon={<IconAlertCircle size={16} />} py="xs">
                    {saveErr}
                  </Alert>
                )}

                <Group justify="space-between" mt="xs">
                  <Group gap="xs">
                    <Button
                      color="brand"
                      leftSection={<IconDeviceFloppy size={16} />}
                      loading={saving}
                      disabled={!dirty}
                      onClick={handleSave}
                    >
                      {saved && !dirty ? "Сохранено" : "Сохранить"}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      loading={saving}
                      onClick={handleResetRequests}
                      title="Обнулить израсходованные запросы (свежая квота)"
                    >
                      Сбросить запросы
                    </Button>
                  </Group>

                  {confirmDelete ? (
                    <Group gap="xs">
                      <Button
                        color="red"
                        variant="filled"
                        size="sm"
                        loading={deleting}
                        onClick={handleDelete}
                      >
                        Точно удалить
                      </Button>
                      <Button
                        variant="subtle"
                        color="gray"
                        size="sm"
                        onClick={() => setConfirmDelete(false)}
                      >
                        Отмена
                      </Button>
                    </Group>
                  ) : (
                    <Button
                      color="red"
                      variant="light"
                      size="sm"
                      leftSection={<IconTrash size={16} />}
                      onClick={() => setConfirmDelete(true)}
                    >
                      Удалить
                    </Button>
                  )}
                </Group>
              </Stack>
            </Paper>

            {/* Тип личности, бриф и платежи — сворачиваемыми блоками */}
            <Accordion
              variant="separated"
              radius="md"
              chevronPosition="right"
              multiple
            >
              {/* Проекты пользователя + бриф каждого (бриф теперь у проекта). */}
              <Accordion.Item value="projects">
                <Accordion.Control>
                  <Text fw={600} size="sm">
                    Проекты и брифы
                    {projects && projects.length > 0 ? ` (${projects.length})` : ""}
                  </Text>
                </Accordion.Control>
                <Accordion.Panel>
                  {projects === null ? (
                    <Group justify="center" py="sm">
                      <Loader size="sm" color="brand" />
                    </Group>
                  ) : projects.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      Проектов пока нет.
                    </Text>
                  ) : (
                    <Stack gap="md">
                      {projects.map((pr) => {
                        const prof = pr.brief?.disc ? DISC_PROFILES[pr.brief.disc] : null;
                        const hasFields =
                          pr.brief &&
                          (BRIEF_FIELDS.some((f) => pr.brief?.[f.key]) || pr.brief.cameraExp);
                        return (
                          <Paper key={pr.id} withBorder radius="md" p="sm">
                            <Group justify="space-between" wrap="nowrap" mb="xs" gap="xs">
                              <Text fw={600} size="sm" truncate>
                                {pr.title}
                              </Text>
                              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                                {pr.messageCount} сообщ.
                              </Text>
                            </Group>
                            {prof && (
                              <Group gap="xs" mb="xs" wrap="nowrap">
                                <Image
                                  src={`/images/disc/${prof.code}.webp`}
                                  alt={`Типаж «${prof.nick}»`}
                                  fit="contain"
                                  w={44}
                                  h={44}
                                  radius="sm"
                                />
                                <Text size="sm">
                                  Тип: «{prof.nick}»{" "}
                                  <Text span c="dimmed" size="xs">
                                    ({prof.code})
                                  </Text>
                                </Text>
                              </Group>
                            )}
                            {hasFields ? (
                              <Stack gap={6}>
                                {BRIEF_FIELDS.map((f) => {
                                  const v = pr.brief?.[f.key];
                                  if (!v) return null;
                                  return (
                                    <div key={f.key}>
                                      <Text size="xs" c="dimmed">
                                        {f.label}
                                      </Text>
                                      <Text size="sm">{String(v)}</Text>
                                    </div>
                                  );
                                })}
                                {pr.brief?.cameraExp && (
                                  <div>
                                    <Text size="xs" c="dimmed">
                                      Опыт на камере
                                    </Text>
                                    <Text size="sm">{cameraLabel(pr.brief.cameraExp)}</Text>
                                  </div>
                                )}
                              </Stack>
                            ) : (
                              <Text size="xs" c="dimmed">
                                Поля «о проекте» не заполнены.
                              </Text>
                            )}
                          </Paper>
                        );
                      })}
                    </Stack>
                  )}
                </Accordion.Panel>
              </Accordion.Item>

              {/* История платежей (пополнения). «Траты» — позже. */}
              <Accordion.Item value="payments">
                <Accordion.Control>
                  <Text fw={600} size="sm">
                    История платежей
                    {payments && payments.length > 0 ? ` (${payments.length})` : ""}
                  </Text>
                </Accordion.Control>
                <Accordion.Panel>
                  {payments === null ? (
                    <Group justify="center" py="sm">
                      <Loader size="sm" color="brand" />
                    </Group>
                  ) : payments.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      Платежей пока нет.
                    </Text>
                  ) : (
                    <Stack gap="xs">
                      {payments.map((pay) => (
                        <Group key={pay.id} justify="space-between" wrap="nowrap" gap="sm">
                          <div style={{ minWidth: 0 }}>
                            <Text size="sm" fw={500}>
                              {formatPrice(pay.amount / 100)}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {pay.planLabel} ·{" "}
                              {new Date(pay.paidAt ?? pay.createdAt).toLocaleString("ru-RU")}
                            </Text>
                          </div>
                          <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                            <PaymentProviderBadge provider={pay.provider} />
                            <PaymentStatusBadge status={pay.status} />
                          </Group>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}
