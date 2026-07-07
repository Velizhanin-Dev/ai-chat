"use client";

import { useEffect, useState } from "react";
import {
  Title,
  Text,
  Stack,
  Group,
  TextInput,
  Select,
  Table,
  Pagination,
  Loader,
  Paper,
  Alert,
} from "@mantine/core";
import { IconSearch, IconAlertCircle, IconMail } from "@tabler/icons-react";
import { PlanBadge, PaymentStatusBadge } from "@/components/Admin/Badges";
import { formatPrice } from "@/lib/plans";
import type { AdminPaymentListRow } from "@/app/api/admin/payments/route";

// Глобальная история платежей (все пользователи). Пагинация + поиск по плательщику
// + фильтр по статусу. Данные — GET /api/admin/payments (без userId = список).

const STATUS_OPTIONS = [
  { value: "paid", label: "Оплаченные" },
  { value: "pending", label: "Ожидают" },
  { value: "failed", label: "Отклонённые" },
  { value: "refund", label: "Возвраты" },
];

export default function AdminPaymentsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    payments: AdminPaymentListRow[];
    total: number;
    pageSize: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [q, status]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ page: String(page) });
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);
      fetch(`/api/admin/payments?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          if (alive) {
            setData(d);
            setError(null);
          }
        })
        .catch(() => alive && setError("Не удалось загрузить платежи"))
        .finally(() => alive && setLoading(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, status, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Платежи</Title>
        <Text c="dimmed" size="sm" mt={4}>
          {data ? `Всего: ${data.total}` : "Загрузка…"}
        </Text>
      </div>

      <Group align="flex-end" gap="sm" wrap="wrap">
        <TextInput
          label="Поиск"
          placeholder="Поиск по имени или почте плательщика"
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={{ base: "100%", xs: 340 }}
        />
        <Select
          label="Статус"
          value={status || null}
          onChange={(v) => setStatus(v ?? "")}
          placeholder="Все статусы"
          clearable
          data={STATUS_OPTIONS}
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
          <Table verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Плательщик</Table.Th>
                <Table.Th miw={120}>Тариф</Table.Th>
                <Table.Th>Сумма</Table.Th>
                <Table.Th miw={110}>Статус</Table.Th>
                <Table.Th>Дата</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data?.payments.map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {p.userName}
                    </Text>
                    <Group gap={4} wrap="nowrap" c="dimmed">
                      <IconMail size={12} />
                      <Text size="xs" c="dimmed">
                        {p.userEmail}
                      </Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <PlanBadge plan={p.planId} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {formatPrice(p.amount / 100)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <PaymentStatusBadge status={p.status} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {new Date(p.paidAt ?? p.createdAt).toLocaleString("ru-RU")}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
              {data && data.payments.length === 0 && !loading && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text ta="center" c="dimmed" py="lg">
                      Платежей не найдено
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
    </Stack>
  );
}
