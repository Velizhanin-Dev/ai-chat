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
  ThemeIcon,
  List,
  Alert,
  Accordion,
} from "@mantine/core";
import {
  IconSearch,
  IconAlertCircle,
  IconSparkles,
  IconCheck,
  IconMail,
  IconMailOff,
} from "@tabler/icons-react";
import { DISC_PROFILES, CAMERA_OPTIONS } from "@/lib/brief";
import { PLAN_LABEL, type PlanId } from "@/store/authSlice";
import { formatPrice } from "@/lib/plans";
import type { AdminUserRow } from "@/app/api/admin/users/route";
import type { AdminPaymentRow } from "@/app/api/admin/payments/route";

// Статус платежа → цвет/подпись бейджа.
function paymentBadge(status: string): { color: string; label: string } {
  if (status === "CONFIRMED") return { color: "teal", label: "оплачено" };
  if (["REJECTED", "CANCELED", "DEADLINE_EXPIRED", "AUTH_FAIL"].includes(status))
    return { color: "red", label: "отклонён" };
  if (["REFUNDED", "PARTIAL_REFUNDED"].includes(status))
    return { color: "orange", label: "возврат" };
  return { color: "gray", label: "ожидает" };
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

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ users: AdminUserRow[]; total: number; pageSize: number } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  // История платежей выбранного юзера (грузим при открытии карточки).
  const [payments, setPayments] = useState<AdminPaymentRow[] | null>(null);

  useEffect(() => {
    if (!selected) {
      setPayments(null);
      return;
    }
    let alive = true;
    setPayments(null);
    fetch(`/api/admin/payments?userId=${encodeURIComponent(selected.id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { payments: AdminPaymentRow[] }) => alive && setPayments(d.payments))
      .catch(() => alive && setPayments([]));
    return () => {
      alive = false;
    };
  }, [selected]);

  // Сброс на первую страницу при смене поискового запроса.
  useEffect(() => {
    setPage(1);
  }, [q]);

  // Загрузка списка (дебаунс по поиску, чтобы не дёргать API на каждый символ).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ page: String(page) });
      if (q.trim()) params.set("q", q.trim());
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
  }, [q, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const profile = selected?.disc ? DISC_PROFILES[selected.disc] : null;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Пользователи</Title>
        <Text c="dimmed" size="sm" mt={4}>
          {data ? `Всего: ${data.total}` : "Загрузка…"}
        </Text>
      </div>

      <TextInput
        placeholder="Поиск по имени или почте"
        leftSection={<IconSearch size={16} />}
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        maw={360}
      />

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
                <Table.Th>Тариф</Table.Th>
                <Table.Th>Типаж</Table.Th>
                <Table.Th>Бриф</Table.Th>
                <Table.Th>Регистрация</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data?.users.map((u) => {
                const p = u.disc ? DISC_PROFILES[u.disc] : null;
                return (
                  <Table.Tr
                    key={u.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelected(u)}
                  >
                    <Table.Td>
                      <Text size="sm" fw={500}>
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
                      <Badge variant="default" radius="sm">
                        {planLabel(u.plan)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {p ? (
                        <Text size="sm">
                          «{p.nick}»{" "}
                          <Text span c="dimmed" size="xs">
                            ({p.code})
                          </Text>
                        </Text>
                      ) : (
                        <Text size="sm" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {u.briefCompleted ? (
                        <Badge color="teal" variant="light" radius="sm" leftSection={<IconCheck size={12} />}>
                          пройден
                        </Badge>
                      ) : (
                        <Badge color="gray" variant="light" radius="sm">
                          нет
                        </Badge>
                      )}
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
            <Stack gap={4}>
              <Group gap="xs" wrap="nowrap">
                {selected.emailVerified ? <IconMail size={14} /> : <IconMailOff size={14} />}
                <Text size="sm">{selected.email}</Text>
              </Group>
              <Group gap="xs">
                <Badge variant="default" radius="sm">
                  {planLabel(selected.plan)}
                </Badge>
                {selected.role === "admin" && (
                  <Badge color="brand" variant="light" radius="sm">
                    admin
                  </Badge>
                )}
                <Badge
                  color={selected.briefCompleted ? "teal" : "gray"}
                  variant="light"
                  radius="sm"
                >
                  бриф: {selected.briefCompleted ? "пройден" : "нет"}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                Регистрация: {new Date(selected.createdAt).toLocaleString("ru-RU")}
              </Text>
            </Stack>

            {/* Архетип харизмы */}
            {profile && (
              <Paper withBorder radius="md" p="md">
                <Image
                  src={`/images/disc/${profile.code}.webp`}
                  alt={`Типаж «${profile.nick}»`}
                  fit="contain"
                  w="auto"
                  maw="100%"
                  mah={180}
                  mx="auto"
                  radius="md"
                  mb="md"
                />
                <Group gap="xs" mb="xs">
                  <ThemeIcon color="brand" variant="light" radius="xl" size="md">
                    <IconSparkles size={16} />
                  </ThemeIcon>
                  <Title order={5}>
                    «{profile.nick}»{" "}
                    <Text span c="dimmed" fz="sm">
                      ({profile.code})
                    </Text>
                  </Title>
                </Group>
                <Text size="sm" mb="sm">
                  {profile.character}
                </Text>
                <List size="sm" spacing={4}>
                  <List.Item>
                    <Text span fw={500}>
                      Форматы:
                    </Text>{" "}
                    {profile.formats}
                  </List.Item>
                  <List.Item>
                    <Text span fw={500}>
                      Заводит:
                    </Text>{" "}
                    {profile.works}
                  </List.Item>
                  <List.Item>
                    <Text span fw={500}>
                      Убивает:
                    </Text>{" "}
                    {profile.kills}
                  </List.Item>
                </List>
              </Paper>
            )}

            {/* Поля брифа «о проекте» — отдельным блоком */}
            <Paper withBorder radius="md" p="md">
              <Text fw={600} size="sm" mb="xs">
                Бриф о проекте
              </Text>
              {selected.brief &&
              (BRIEF_FIELDS.some((f) => selected.brief?.[f.key]) || selected.brief.cameraExp) ? (
                <Stack gap="sm">
                  {BRIEF_FIELDS.map((f) => {
                    const v = selected.brief?.[f.key];
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
                  {selected.brief.cameraExp && (
                    <div>
                      <Text size="xs" c="dimmed">
                        Опыт на камере
                      </Text>
                      <Text size="sm">{cameraLabel(selected.brief.cameraExp)}</Text>
                    </div>
                  )}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  Поля «о проекте» не заполнены (можно пропускать — обязателен только тест).
                </Text>
              )}
            </Paper>

            {/* История платежей (пополнения) — сворачиваемым блоком. «Траты» — позже. */}
            <Accordion variant="separated" radius="md" chevronPosition="right">
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
                      {payments.map((pay) => {
                        const b = paymentBadge(pay.status);
                        return (
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
                            <Badge color={b.color} variant="light" radius="sm" style={{ flexShrink: 0 }}>
                              {b.label}
                            </Badge>
                          </Group>
                        );
                      })}
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
