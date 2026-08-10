"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { IconAlertCircle, IconSearch } from "@tabler/icons-react";
import { apiChannelVideosForLink } from "@/lib/content-plan-client";
import { bestMatch, titleSimilarity, type LinkVideo } from "@/lib/content-plan";

// Пикер реального ролика канала: привязка к карточке плана или импорт нового.
// Сверху — автоподбор по похожести названия («похоже на твой ролик X»).
export default function LinkVideoModal({
  projectId,
  opened,
  onClose,
  planTitle,
  onPick,
}: {
  projectId: string;
  opened: boolean;
  onClose: () => void;
  // Название карточки плана — для автоподбора (пусто при импорте нового).
  planTitle?: string;
  onPick: (v: LinkVideo) => void;
}) {
  const [videos, setVideos] = useState<LinkVideo[]>([]);
  const [connected, setConnected] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!opened) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiChannelVideosForLink(projectId).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setVideos(res.data.videos);
        setConnected(res.data.connected);
      } else setError(res.error);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [opened, projectId]);

  // Автоподбор — лучший по похожести названия (если карточка уже названа).
  const suggestion = useMemo(
    () => (planTitle ? bestMatch(planTitle, videos) : null),
    [planTitle, videos]
  );

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? videos.filter((v) => v.title.toLowerCase().includes(needle))
      : videos;
    // Без поиска — сперва самые похожие на название карточки, потом по просмотрам.
    if (!needle && planTitle) {
      return [...base].sort(
        (a, b) => titleSimilarity(planTitle, b.title) - titleSimilarity(planTitle, a.title)
      );
    }
    return base;
  }, [videos, q, planTitle]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={planTitle ? "Привязать ролик с канала" : "Импортировать ролик с канала"}
      size="lg"
      radius="lg"
    >
      <Stack gap="sm">
        {loading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" color="brand" />
          </Group>
        ) : !connected ? (
          <Alert color="gray" icon={<IconAlertCircle size={16} />}>
            YouTube-канал не подключён к проекту. Подключи его в настройках проекта — тогда
            смогу связать план с реальными роликами.
          </Alert>
        ) : error ? (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        ) : (
          <>
            {suggestion && (
              <Box
                className="ach-spotlight"
                style={{ display: "flex", gap: 12, alignItems: "center" }}
              >
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text size="xs" c="brand" fw={700} tt="uppercase" style={{ letterSpacing: "0.04em" }}>
                    Похоже на твой ролик
                  </Text>
                  <Text fw={600} lineClamp={1}>
                    {suggestion.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {suggestion.views.toLocaleString("ru-RU")} просмотров
                  </Text>
                </Box>
                <Button size="xs" color="brand" onClick={() => onPick(suggestion)}>
                  Связать
                </Button>
              </Box>
            )}

            <TextInput
              placeholder="Поиск по названию"
              leftSection={<IconSearch size={15} />}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />

            <ScrollArea.Autosize mah={420}>
              <Stack gap={6}>
                {list.length === 0 ? (
                  <Text size="sm" c="dimmed" py="md" ta="center">
                    Роликов не нашлось
                  </Text>
                ) : (
                  list.map((v) => (
                    <UnstyledButton
                      key={v.id}
                      className="cp-pick-row"
                      onClick={() => onPick(v)}
                    >
                      <Group gap="sm" wrap="nowrap">
                        {v.thumbnail && (
                          <img
                            src={v.thumbnail}
                            alt=""
                            style={{ width: 92, borderRadius: 6, flexShrink: 0 }}
                          />
                        )}
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="sm" lineClamp={2}>
                            {v.title}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {v.views.toLocaleString("ru-RU")} просмотров
                          </Text>
                        </Box>
                        {planTitle && titleSimilarity(planTitle, v.title) >= 0.4 && (
                          <Badge size="xs" color="brand" variant="light" radius="sm">
                            похоже
                          </Badge>
                        )}
                      </Group>
                    </UnstyledButton>
                  ))
                )}
              </Stack>
            </ScrollArea.Autosize>
          </>
        )}
      </Stack>
    </Modal>
  );
}
