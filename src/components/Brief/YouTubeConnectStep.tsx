"use client";

import { ytImage } from "@/lib/image-proxy";

import { useEffect, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Group,
  List,
  Loader,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconBrandYoutube,
  IconCheck,
  IconAlertCircle,
  IconSparkles,
  IconArrowRight,
} from "@tabler/icons-react";
import {
  apiYouTubePendingStatus,
  apiYouTubePendingDisconnect,
  youtubeDraftConnectHref,
} from "@/lib/youtube-client";
import type { YouTubeStatus } from "@/lib/youtube-types";

// ── Первый шаг создания проекта: подключить YouTube-канал ────────────────────
// Проекта ещё нет (он создаётся в конце брифа), поэтому подключение идёт в режиме
// «черновик»: токены ложатся на юзера и переезжают в проект при его создании.
// Подключил — нейронка заполнит бриф по каналу; не хочет — идём в бриф руками.

// Тексты по коду возврата из OAuth (?yt=...). Успех тут не показываем — после него
// сразу уходим в автозаполнение (см. /app).
const FAIL_TEXT: Record<string, string> = {
  denied: "Подключение отменено — можно заполнить бриф руками.",
  state: "Сессия подключения устарела, попробуйте ещё раз.",
  nochannel: "У этого Google-аккаунта нет YouTube-канала.",
  failed: "Не удалось подключить YouTube. Попробуйте ещё раз или заполните бриф руками.",
  unavailable: "Интеграция YouTube пока не настроена — заполним бриф руками.",
  noproject: "Не удалось подключить канал. Заполните бриф руками.",
};

export interface YouTubeConnectStepProps {
  // Юзер отказался подключать канал → идём в обычный бриф.
  onSkip: () => void;
  // Канал уже подключён (черновик) и юзер жмёт «Продолжить» → автозаполнение.
  onContinue: () => void;
  // Код возврата из OAuth (?yt=...), если он был — показываем причину отказа.
  ytError?: string | null;
  // Куда Google вернёт после согласия.
  returnTo: string;
}

export default function YouTubeConnectStep({
  onSkip,
  onContinue,
  ytError,
  returnTo,
}: YouTubeConnectStepProps) {
  const [status, setStatus] = useState<YouTubeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    let alive = true;
    void apiYouTubePendingStatus().then((res) => {
      if (!alive) return;
      if (res.ok) setStatus(res.data);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const disconnect = async () => {
    setDisconnecting(true);
    await apiYouTubePendingDisconnect();
    setDisconnecting(false);
    setStatus((s) => (s ? { ...s, connected: false, channel: null } : s));
  };

  if (loading) {
    return (
      <Group justify="center" py={64}>
        <Loader color="brand" />
      </Group>
    );
  }

  const failText = ytError && ytError !== "connected" ? FAIL_TEXT[ytError] : null;

  // Канал уже подключён (вернулись из OAuth или подключали раньше) — показываем
  // карточку канала и зовём дальше, к автозаполнению брифа.
  if (status?.connected && status.channel) {
    return (
      <Stack gap="lg">
        <div>
          <Title order={4}>Канал подключён</Title>
          <Text size="sm" c="dimmed" mt={6}>
            Сейчас разберу его и заполню бриф за тебя — останется только проверить.
          </Text>
        </div>

        <Paper withBorder radius="md" p="md">
          <Group wrap="nowrap">
            <Avatar src={ytImage(status.channel.thumbnail) ?? undefined} radius="xl" size={48}>
              <IconBrandYoutube size={24} />
            </Avatar>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Text fw={600} truncate>
                {status.channel.title}
              </Text>
              {status.channel.customUrl && (
                <Text size="sm" c="dimmed" truncate>
                  {status.channel.customUrl}
                </Text>
              )}
            </div>
            <ThemeIcon color="teal" variant="light" radius="xl" size={28}>
              <IconCheck size={16} />
            </ThemeIcon>
          </Group>
        </Paper>

        <Stack gap="sm">
          <Button
            color="brand"
            size="lg"
            radius="md"
            fullWidth
            rightSection={<IconArrowRight size={18} />}
            onClick={onContinue}
          >
            Продолжить
          </Button>
          <Group justify="center" gap="xs">
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              radius="md"
              loading={disconnecting}
              onClick={disconnect}
            >
              Это не тот канал
            </Button>
          </Group>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={4}>Подключим твой YouTube-канал?</Title>
        <Text size="sm" c="dimmed" mt={6}>
          Это самый быстрый старт: я сам вытащу из канала всё, что нужно для брифа, — не
          придётся заполнять руками.
        </Text>
      </div>

      {failText && (
        <Alert icon={<IconAlertCircle size={16} />} color="orange" variant="light">
          {failText}
        </Alert>
      )}

      {status && !status.configured && (
        <Alert icon={<IconAlertCircle size={16} />} color="orange" variant="light">
          Интеграция YouTube пока не настроена на сервере — заполним бриф руками.
        </Alert>
      )}

      <Paper withBorder radius="md" p="md">
        <List
          spacing="xs"
          size="sm"
          icon={
            <ThemeIcon color="brand" variant="light" radius="xl" size={22}>
              <IconSparkles size={13} />
            </ThemeIcon>
          }
        >
          <List.Item>Заполню нишу, продукт, аудиторию и экспертность по твоим роликам</List.Item>
          <List.Item>Буду разбирать канал по цифрам прямо в чате</List.Item>
          <List.Item>Аналитика канала появится в разделе «Канал»</List.Item>
        </List>
      </Paper>

      <Stack gap="sm">
        <Button
          component="a"
          href={youtubeDraftConnectHref(returnTo)}
          color="brand"
          size="lg"
          radius="md"
          fullWidth
          leftSection={<IconBrandYoutube size={20} />}
          disabled={status ? !status.configured : false}
        >
          Подключить YouTube
        </Button>
        <Button variant="subtle" color="gray" size="md" radius="md" fullWidth onClick={onSkip}>
          У меня нет канала — заполню сам
        </Button>
      </Stack>

      <Text size="xs" c="dimmed" ta="center">
        Доступ только на чтение — публиковать и менять ничего не смогу. Отключить можно в
        любой момент в настройках проекта.
      </Text>
    </Stack>
  );
}
