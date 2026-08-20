"use client";

import { ytImage } from "@/lib/image-proxy";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Skeleton,
  Text,
} from "@mantine/core";
import { IconAlertTriangle, IconBrandInstagram, IconCheck } from "@tabler/icons-react";
import {
  apiInstagramDisconnect,
  apiInstagramStatus,
  instagramConnectHref,
  IG_CALLBACK_MESSAGE,
  type IgStatus,
} from "@/lib/instagram-client";

// Подключение Instagram в настройках ПРОЕКТА (как YouTubeConnect у YouTube-проектов).
//
// ⚠️ Нужен профессиональный аккаунт — Business или Creator. У личного Instagram
// insights не отдаёт вовсе, и человек упрётся в это уже ПОСЛЕ экрана согласия,
// поэтому предупреждаем заранее.
export default function InstagramConnect({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [status, setStatus] = useState<IgStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await apiInstagramStatus(projectId);
    if (res.ok) setStatus(res.data);
    else setStatus({ configured: false, connected: false, account: null });
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Возврат из OAuth: ?ig=<код> → тост. Параметр из URL не чистим — раздел
  // настроек и так перезагружает статус, а история браузера остаётся честной.
  useEffect(() => {
    const code = search?.get("ig");
    if (code) setToast(IG_CALLBACK_MESSAGE[code] ?? null);
  }, [search]);

  const disconnect = async () => {
    setBusy(true);
    const res = await apiInstagramDisconnect(projectId);
    setBusy(false);
    setConfirm(false);
    if (res.ok) {
      setStatus({ configured: status?.configured ?? true, connected: false, account: null });
      setToast({ ok: true, text: "Аккаунт отключён" });
    } else setToast({ ok: false, text: res.error });
  };

  if (!status) return <Skeleton h={120} radius="md" />;

  const account = status.account;
  // Токен Instagram живёт 60 дней и продлевается сам, но если человек не заходил
  // дольше — продлевать уже нечего, нужно переподключение. Предупреждаем за неделю.
  const daysLeft = account
    ? Math.floor((new Date(account.expiresAt).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <Paper className="an-surface" p="md">
      <Group justify="space-between" wrap="wrap" gap="sm" align="flex-start">
        <Box style={{ minWidth: 0 }}>
          <Group gap={8}>
            <IconBrandInstagram size={20} />
            <Text fw={600}>Instagram</Text>
            {status.connected && (
              <Badge size="sm" color="teal" variant="light" leftSection={<IconCheck size={11} />}>
                подключён
              </Badge>
            )}
          </Group>
          <Text size="sm" mt={4}>
            {status.connected
              ? "Аналитика рилсов: удержание, пропуски и вовлечение — по вашим цифрам."
              : "Подключите профессиональный аккаунт (Business или Creator) — у личного Instagram статистику не отдаёт."}
          </Text>
        </Box>

        {status.connected ? (
          confirm ? (
            <Group gap="xs">
              <Button color="red" size="xs" loading={busy} onClick={() => void disconnect()}>
                Отключить
              </Button>
              <Button variant="default" size="xs" onClick={() => setConfirm(false)}>
                Отмена
              </Button>
            </Group>
          ) : (
            <Button variant="default" size="xs" onClick={() => setConfirm(true)}>
              Отключить
            </Button>
          )
        ) : (
          <Button
            component="a"
            href={instagramConnectHref(projectId, pathname || `/${projectId}/settings`)}
            color="brand"
            leftSection={<IconBrandInstagram size={16} />}
            disabled={!status.configured}
          >
            Подключить
          </Button>
        )}
      </Group>

      {account && (
        <Group gap="sm" mt="md" wrap="nowrap">
          {account.profilePicture && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ytImage(account.profilePicture) ?? undefined}
              alt=""
              width={40}
              height={40}
              style={{ borderRadius: "50%", flexShrink: 0 }}
            />
          )}
          <Box style={{ minWidth: 0 }}>
            <Text fw={600} truncate>
              @{account.username}
            </Text>
            <Text size="xs" c="dimmed">
              {account.followers.toLocaleString("ru-RU")} подписчиков
            </Text>
          </Box>
        </Group>
      )}

      {daysLeft != null && daysLeft <= 7 && (
        <Alert color="orange" mt="md" icon={<IconAlertTriangle size={16} />}>
          Доступ к аккаунту истекает через {daysLeft} дн. Зайдите в раздел «Аналитика» —
          он продлится сам, либо подключите аккаунт заново.
        </Alert>
      )}

      {!status.configured && (
        <Text size="xs" c="dimmed" mt="sm">
          Интеграция не настроена на сервере (нужны INSTAGRAM_APP_ID и INSTAGRAM_APP_SECRET).
        </Text>
      )}

      {toast && (
        <Alert color={toast.ok ? "teal" : "red"} mt="md" withCloseButton onClose={() => setToast(null)}>
          {toast.text}
        </Alert>
      )}
    </Paper>
  );
}
