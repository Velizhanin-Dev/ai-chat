"use client";

import { ytImage } from "@/lib/image-proxy";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Alert,
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconBrandYoutube,
  IconCheck,
  IconAlertCircle,
  IconPlugConnected,
  IconExternalLink,
} from "@tabler/icons-react";
import {
  apiYouTubeStatus,
  apiYouTubeDisconnect,
  youtubeConnectHref,
} from "@/lib/youtube-client";
import type { YouTubeStatus } from "@/lib/youtube-types";

// Тексты тостов по коду возврата из OAuth (?yt=...).
const RESULT: Record<string, { color: string; text: string }> = {
  connected: { color: "teal", text: "YouTube подключён — данные канала уже в разделе «Канал»." },
  denied: { color: "red", text: "Подключение отменено." },
  state: { color: "red", text: "Сессия подключения устарела, попробуйте ещё раз." },
  nochannel: { color: "orange", text: "У этого Google-аккаунта нет YouTube-канала." },
  failed: { color: "red", text: "Не удалось подключить YouTube. Попробуйте ещё раз." },
  unavailable: { color: "orange", text: "Интеграция YouTube пока не настроена на сервере." },
};

// Карточка «Интеграция YouTube» в настройках ПРОЕКТА: подключение канала к этому
// проекту и состояние «подключено» (аватар канала + отключить). Интеграция
// пер-проектная — у каждого проекта свой канал. Данные канала — в разделе «Канал».
export default function YouTubeConnect({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<YouTubeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ color: string; text: string } | null>(null);

  const load = async () => {
    const res = await apiYouTubeStatus(projectId);
    if (res.ok) setStatus(res.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Тост по возврату из OAuth (?yt=...); чистим параметр из URL после прочтения.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("yt");
    if (!code) return;
    setResult(RESULT[code] ?? { color: "gray", text: "Готово." });
    params.delete("yt");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (qs ? `?${qs}` : "")
    );
  }, []);

  const disconnect = async () => {
    setDisconnecting(true);
    const res = await apiYouTubeDisconnect(projectId);
    setDisconnecting(false);
    setConfirming(false);
    if (res.ok) {
      setStatus((s) => (s ? { ...s, connected: false, channel: null } : s));
      setResult({ color: "gray", text: "YouTube отключён." });
    } else {
      setResult({ color: "red", text: res.error });
    }
  };

  const connectHref = youtubeConnectHref(projectId, pathname || "/app");

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Text fw={500}>Интеграции</Text>
      </Group>

      {result && (
        <Alert
          color={result.color}
          variant="light"
          icon={
            result.color === "teal" ? (
              <IconCheck size={16} />
            ) : (
              <IconAlertCircle size={16} />
            )
          }
          withCloseButton
          onClose={() => setResult(null)}
        >
          {result.text}
        </Alert>
      )}

      <Paper withBorder radius="lg" p="md">
        {loading ? (
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <Skeleton height={44} circle />
              <Stack gap={6}>
                <Skeleton height={14} width={160} radius="sm" />
                <Skeleton height={10} width={110} radius="sm" />
              </Stack>
            </Group>
            <Skeleton height={36} width={120} radius="md" />
          </Group>
        ) : status?.connected && status.channel ? (
          // ── Подключено ──────────────────────────────────────────────
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
              <Avatar
                src={ytImage(status.channel.thumbnail) ?? undefined}
                radius="xl"
                size={44}
                color="red"
              >
                <IconBrandYoutube size={24} />
              </Avatar>
              <Box style={{ minWidth: 0 }}>
                <Group gap={6} wrap="nowrap">
                  <Text fw={600} truncate>
                    {status.channel.title}
                  </Text>
                  <Badge
                    color="teal"
                    variant="light"
                    size="sm"
                    leftSection={<IconCheck size={12} />}
                    style={{ flexShrink: 0 }}
                  >
                    Подключено
                  </Badge>
                </Group>
                {status.channel.customUrl ? (
                  <Anchor
                    href={`https://www.youtube.com/${status.channel.customUrl}`}
                    target="_blank"
                    rel="noreferrer"
                    size="sm"
                    c="dimmed"
                  >
                    <Group gap={4} wrap="nowrap">
                      {status.channel.customUrl}
                      <IconExternalLink size={12} />
                    </Group>
                  </Anchor>
                ) : (
                  <Text size="sm" c="dimmed">
                    YouTube-канал
                  </Text>
                )}
              </Box>
            </Group>

            {confirming ? (
              <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                <Button
                  color="red"
                  variant="light"
                  size="xs"
                  loading={disconnecting}
                  onClick={disconnect}
                >
                  Отключить
                </Button>
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  onClick={() => setConfirming(false)}
                >
                  Отмена
                </Button>
              </Group>
            ) : (
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                style={{ flexShrink: 0 }}
                onClick={() => setConfirming(true)}
              >
                Отключить
              </Button>
            )}
          </Group>
        ) : (
          // ── Не подключено ───────────────────────────────────────────
          <Group justify="space-between" wrap="nowrap" align="center">
            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
              <ThemeIcon color="red" variant="light" radius="xl" size={44}>
                <IconBrandYoutube size={26} />
              </ThemeIcon>
              <Box style={{ minWidth: 0 }}>
                <Text fw={600}>YouTube</Text>
                <Text size="sm" c="dimmed">
                  Подключи канал — в разделе «Канал» появятся статистика, видео и
                  динамика просмотров.
                </Text>
              </Box>
            </Group>

            <Button
              component="a"
              href={connectHref}
              color="brand"
              leftSection={<IconPlugConnected size={18} />}
              disabled={!status?.configured}
              style={{ flexShrink: 0 }}
            >
              Подключить
            </Button>
          </Group>
        )}
      </Paper>

      {status && !status.configured && !status.connected && (
        <Text size="xs" c="dimmed">
          Интеграция появится, когда администратор настроит Google-приложение.
        </Text>
      )}
    </Stack>
  );
}
