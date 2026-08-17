"use client";

import { useEffect, useState } from "react";
import {
  Title,
  Text,
  Stack,
  Group,
  Paper,
  Table,
  Loader,
  Alert,
  SegmentedControl,
  SimpleGrid,
  Badge,
} from "@mantine/core";
import { IconAlertCircle, IconInfoCircle } from "@tabler/icons-react";
import type { SourcesView } from "@/app/api/admin/sources/route";

// Откуда приходят и откуда покупают. Строка = utm-метка (источник/канал/кампания):
// регистрации по ней, оплаты и выручка. Данные — GET /api/admin/sources.

const PERIODS = [
  { value: "7", label: "7 дней" },
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
  { value: "0", label: "Всё время" },
];

const money = (rub: number) =>
  rub.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";

// Конверсия «из регистрации в оплату» по метке. Оплат может оказаться больше
// регистраций (человек пришёл раньше периода, а купил внутри) — не прячем это,
// цифра честная и сама по себе сигнал.
const conv = (payments: number, signups: number) =>
  signups > 0 ? `${Math.round((payments / signups) * 100)}%` : "—";

export default function AdminSourcesPage() {
  const [days, setDays] = useState("30");
  const [data, setData] = useState<SourcesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/admin/sources?days=${days}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: SourcesView) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch(() => alive && setError("Не удалось загрузить отчёт"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [days]);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <div>
          <Title order={2}>Источники</Title>
          <Text c="dimmed" size="sm" mt={4}>
            Откуда приходят и откуда покупают — по utm-меткам ссылок
          </Text>
        </div>
        <SegmentedControl value={days} onChange={setDays} data={PERIODS} size="sm" />
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}

      {data && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <Kpi label="Регистраций" value={String(data.totals.signups)} />
          <Kpi label="Оплат" value={String(data.totals.payments)} />
          <Kpi label="Выручка" value={money(data.totals.revenue)} />
          <Kpi
            label="Конверсия"
            value={conv(data.totals.payments, data.totals.signups)}
          />
        </SimpleGrid>
      )}

      {data && data.inheritedPayments > 0 && (
        <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
          У {data.inheritedPayments}{" "}
          {plural(data.inheritedPayments, "оплаты", "оплат", "оплат")} своей метки не
          было — человек пришёл на сайт напрямую (закладка, поиск в почте). Такие
          покупки записаны на источник, с которого он когда-то зарегистрировался.
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
        <Table.ScrollContainer minWidth={700}>
          <Table verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Источник</Table.Th>
                <Table.Th>Канал</Table.Th>
                <Table.Th>Кампания</Table.Th>
                <Table.Th ta="right">Регистраций</Table.Th>
                <Table.Th ta="right">Оплат</Table.Th>
                <Table.Th ta="right">Конверсия</Table.Th>
                <Table.Th ta="right">Выручка</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data?.rows.map((r) => (
                <Table.Tr key={r.key}>
                  <Table.Td>
                    {r.source === "—" ? (
                      <Badge variant="light" color="gray" radius="sm">
                        без меток
                      </Badge>
                    ) : (
                      <Text size="sm" fw={500}>
                        {r.source}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {r.medium}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {r.campaign}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm">{r.signups}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" fw={r.payments ? 600 : 400}>
                      {r.payments}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" c="dimmed">
                      {conv(r.payments, r.signups)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" fw={r.revenue ? 600 : 400} c={r.revenue ? undefined : "dimmed"}>
                      {money(r.revenue)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
              {data && data.rows.length === 0 && !loading && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text ta="center" c="dimmed" py="lg">
                      За период данных нет
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Text size="xs" c="dimmed">
        Метки берём из ссылки вида{" "}
        <Text span ff="monospace" size="xs">
          ?utm_source=tg&amp;utm_medium=article&amp;utm_campaign=ad
        </Text>
        . Источник регистрации — первая ссылка, по которой человек попал на сайт;
        источник оплаты — ссылка того захода, в котором он оформил тариф.
      </Text>
    </Stack>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} fz="xl" style={{ letterSpacing: "-0.02em" }}>
        {value}
      </Text>
    </Paper>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
