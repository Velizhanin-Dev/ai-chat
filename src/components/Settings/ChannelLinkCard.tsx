"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconBrandYoutube, IconCheck, IconLink } from "@tabler/icons-react";
import { ytImage } from "@/lib/image-proxy";
import {
  apiChannelLinkStatus,
  apiLinkChannel,
  apiUnlinkChannel,
  type LinkedChannel,
} from "@/lib/youtube-client";
import { formatCount } from "@/lib/youtube-client";

// Привязка канала ПО ССЫЛКЕ — запасной путь, когда Google-OAuth недоступен.
//
// ⚠️⚠️ Повод из поддержки: у клиента канал на бренд-аккаунте компании, доступ
// только через Творческую студию, и пройти наш OAuth он физически не может. До
// этого такой человек оставался вообще без цифр — ассистент не знал ни одного
// его ролика и предлагал темы «из головы».
//
// ⚠️ Карточка показывается ТОЛЬКО когда OAuth не подключён: полный доступ строго
// лучше публичного, и предлагать «упрощённый» рядом с уже работающим полным —
// значит путать. Подключил через Google — эта карточка исчезает.
export default function ChannelLinkCard({
  projectId,
  onLinked,
}: {
  projectId: string;
  onLinked?: () => void;
}) {
  const [channel, setChannel] = useState<LinkedChannel | null>(null);
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiChannelLinkStatus(projectId).then((res) => {
      if (!alive) return;
      if (res.ok) setChannel(res.data.channel);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const link = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await apiLinkChannel(projectId, value.trim());
    setBusy(false);
    if (res.ok) {
      setChannel(res.data.channel);
      setValue("");
      onLinked?.();
    } else {
      setError(res.error);
    }
  };

  const unlink = async () => {
    setBusy(true);
    const res = await apiUnlinkChannel(projectId);
    setBusy(false);
    if (res.ok) setChannel(null);
  };

  if (loading) return null;

  return (
    <Paper withBorder radius="lg" p="md">
      {channel ? (
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <Avatar src={ytImage(channel.thumbnail) ?? undefined} radius="xl" size={44} color="red">
              <IconBrandYoutube size={24} />
            </Avatar>
            <Box style={{ minWidth: 0 }}>
              <Group gap={6} wrap="nowrap">
                <Text fw={600} truncate>
                  {channel.title}
                </Text>
                <Badge
                  color="blue"
                  variant="light"
                  size="sm"
                  leftSection={<IconLink size={12} />}
                  style={{ flexShrink: 0 }}
                >
                  По ссылке
                </Badge>
              </Group>
              <Text size="sm" c="dimmed">
                {channel.hiddenSubs
                  ? "подписчики скрыты"
                  : `${formatCount(channel.subscribers)} подписчиков`}{" "}
                · {formatCount(channel.videoCount)} видео
              </Text>
              {/* ⚠️ Честно говорим, чего в этом режиме нет. Иначе человек ждёт
                  удержание и CTR, не находит их и считает, что сломалось. */}
              <Text size="xs" c="dimmed" mt={4}>
                Вижу ролики, просмотры и подписчиков. Удержание, CTR и источники
                трафика доступны только через подключение по Google.
              </Text>
            </Box>
          </Group>
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            loading={busy}
            onClick={unlink}
            style={{ flexShrink: 0 }}
          >
            Отвязать
          </Button>
        </Group>
      ) : (
        <Stack gap="sm">
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <Box style={{ minWidth: 0 }}>
              <Text fw={600}>Не получается подключить через Google?</Text>
              <Text size="sm" c="dimmed">
                Так бывает, когда канал на аккаунте бренда и доступ к нему только
                через Творческую студию. Вставьте ссылку на канал — я разберу его
                по публичным данным: увижу ролики, просмотры и подписчиков, и темы
                буду предлагать из того, что у вас реально смотрят.
              </Text>
            </Box>
          </Group>

          {error && (
            <Alert color="orange" variant="light" withCloseButton onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Group gap="xs" wrap="nowrap" align="flex-start">
            <TextInput
              placeholder="https://www.youtube.com/@nazvanie-kanala"
              value={value}
              onChange={(e) => setValue(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void link();
                }
              }}
              style={{ flex: 1 }}
              disabled={busy}
            />
            <Button color="brand" loading={busy} onClick={() => void link()} disabled={!value.trim()}>
              Привязать
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            Подойдёт ссылка на канал, на @хэндл или даже на любой ролик этого
            канала — найду по ней сам.
          </Text>
        </Stack>
      )}
    </Paper>
  );
}
