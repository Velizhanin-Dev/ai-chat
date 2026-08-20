"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Group,
  Loader,
  Skeleton,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconDeviceDesktop, IconTrash } from "@tabler/icons-react";
import { apiDevices, apiRemoveDevice } from "@/lib/devices-client";
import { devicesUnlimited, type DeviceView } from "@/lib/devices";

// Раздел «Устройства» в настройках аккаунта: сколько входов занято по тарифу и
// кто именно вошёл. Удалить можно ЛЮБОЕ устройство, кроме текущего (для выхода
// с этого — кнопка «Выйти» в меню профиля). Удалённое устройство теряет сессию:
// его токен ссылается на слот, которого больше нет (см. src/lib/auth.ts).
export default function DevicesSection() {
  const [devices, setDevices] = useState<DeviceView[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiDevices();
    if (res.ok) {
      setDevices(res.data.devices);
      setLimit(res.data.limit);
      setError(null);
    } else {
      setDevices([]);
      setError(res.error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    setBusy(id);
    const res = await apiRemoveDevice(id);
    setBusy(null);
    if (res.ok) setDevices((prev) => prev?.filter((d) => d.id !== id) ?? prev);
    else setError(res.error);
  };

  const unlimited = devicesUnlimited(limit);

  return (
    <Stack gap="sm">
      <Box>
        <Text fw={600}>Устройства</Text>
        <Text size="sm" c="dimmed">
          {unlimited
            ? "На твоём тарифе число одновременных входов не ограничено."
            : `По тарифу можно заходить с ${limit} ${plural(limit)} одновременно. Чтобы войти с нового — удали лишнее здесь.`}
        </Text>
      </Box>

      {error && (
        <Alert color="red" radius="md">
          {error}
        </Alert>
      )}

      {devices === null ? (
        <Stack gap={8}>
          <Skeleton height={54} radius="md" />
          <Skeleton height={54} radius="md" />
        </Stack>
      ) : devices.length === 0 ? (
        <Text size="sm" c="dimmed">
          Активных устройств нет.
        </Text>
      ) : (
        <Stack gap={8}>
          {devices.map((d) => (
            <Group
              key={d.id}
              justify="space-between"
              wrap="nowrap"
              className="an-surface"
              p="sm"
            >
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <IconDeviceDesktop size={20} />
                <Box style={{ minWidth: 0 }}>
                  <Group gap={6} wrap="nowrap">
                    <Text fw={600} truncate>
                      {d.label}
                    </Text>
                    {d.current && (
                      <Badge size="xs" color="brand" variant="light" radius="sm">
                        это устройство
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed" truncate>
                    вход {formatWhen(d.createdAt)} · активность {formatWhen(d.lastSeenAt)}
                    {d.ip ? ` · ${d.ip}` : ""}
                  </Text>
                </Box>
              </Group>
              {d.current ? (
                <Tooltip label="Чтобы выйти с этого устройства — «Выйти» в меню профиля" withArrow>
                  <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                    текущее
                  </Text>
                </Tooltip>
              ) : busy === d.id ? (
                <Loader size="xs" />
              ) : (
                <Tooltip label="Отключить устройство" withArrow>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Отключить ${d.label}`}
                    onClick={() => remove(d.id)}
                  >
                    <IconTrash size={17} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function plural(n: number): string {
  const t = n % 10;
  const h = n % 100;
  if (t === 1 && h !== 11) return "устройства";
  return "устройств";
}

// Сегодняшние — временем, старые — датой (как в «бороде» под ответом чата).
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  return sameDay
    ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: undefined });
}
