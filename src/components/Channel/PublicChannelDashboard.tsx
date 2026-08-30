"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBrandYoutube,
  IconPlugConnected,
  IconRefresh,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { Modal } from "@mantine/core";
import { IconSparkles, IconPencil } from "@tabler/icons-react";
import { useAppSelector } from "@/store/hooks";
import { ytImage } from "@/lib/image-proxy";
import { formatCount, writeThumbTextsPrompt } from "@/lib/youtube-client";
import AudienceQuestions from "./AudienceQuestions";
import { AnalysisPanel } from "./ChannelDashboard";

// Раздел «Канал» для канала, привязанного ПО ССЫЛКЕ (без OAuth).
//
// ⚠️⚠️ Это НЕ облегчённая копия основного дашборда, а другой экран: половины его
// показателей тут не существует в природе. Удержание, CTR, источники трафика и
// подписчиков по роликам отдаёт только Analytics API под OAuth владельца.
// Рисовать их пустыми нельзя — пустой график читается как «сломалось».
//
// Что тут есть и ради чего это делалось: реальные ролики человека с просмотрами,
// и главное — сравнение каждого с МЕДИАНОЙ его же канала. «×3 к медиане» —
// единственный вывод об упаковке, который можно сделать на публичных данных, и
// он же самый полезный: видно, что у него выстрелило, а что нет.

interface PublicVideoRow {
  id: string;
  title: string;
  thumbnail: string | null;
  views: number;
  likes: number;
  comments: number;
  publishedAt: string;
}

interface Stats {
  channel: {
    channelId: string;
    title: string;
    thumbnail: string | null;
    customUrl: string | null;
    subscribers: number;
    hiddenSubs: boolean;
    videoCount: number;
    views: number;
  };
  videos: PublicVideoRow[];
  medianViews: number;
  fetchedAt: string;
}

export default function PublicChannelDashboard() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";
  const router = useRouter();
  const userId = useAppSelector((st) => st.auth.user?.id ?? "");
  // ИИ-разбор ролика: работает и без OAuth (публичные данные + теги скрейпом),
  // просто без кривой удержания — сервер честно скажет об этом модели.
  const [analyzeVideo, setAnalyzeVideo] = useState<PublicVideoRow | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      if (!projectId) return;
      if (refresh) setRefreshing(true);
      try {
        const qs = new URLSearchParams({ projectId, stats: "1" });
        if (refresh) qs.set("refresh", "1");
        const res = await fetch(`/api/integrations/youtube/link?${qs.toString()}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as { stats?: Stats | null; error?: string };
        if (!res.ok) {
          setError(data.error ?? "Не удалось загрузить данные канала");
          return;
        }
        setError(null);
        setStats(data.stats ?? null);
      } catch {
        setError("Нет связи с сервером");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const settingsHref = `/${projectId}/settings`;

  if (loading) {
    return (
      <Stack gap="md">
        <Skeleton h={110} radius="lg" />
        <Skeleton h={260} radius="lg" />
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      {error && (
        <Alert color="orange" variant="light" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}

      {stats && (
        <>
          <Paper className="an-surface" p="md" radius="lg">
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <Avatar
                  src={ytImage(stats.channel.thumbnail) ?? undefined}
                  radius="xl"
                  size={56}
                  color="red"
                >
                  <IconBrandYoutube size={28} />
                </Avatar>
                <Box style={{ minWidth: 0 }}>
                  <Title order={4} lineClamp={1}>
                    {stats.channel.title}
                  </Title>
                  <Text size="sm" c="dimmed">
                    {stats.channel.hiddenSubs
                      ? "подписчики скрыты"
                      : `${formatCount(stats.channel.subscribers)} подписчиков`}{" "}
                    · {formatCount(stats.channel.views)} просмотров ·{" "}
                    {formatCount(stats.channel.videoCount)} видео
                  </Text>
                  {stats.channel.customUrl && (
                    <Anchor
                      href={`https://www.youtube.com/${stats.channel.customUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      size="xs"
                      c="dimmed"
                    >
                      {stats.channel.customUrl}
                    </Anchor>
                  )}
                </Box>
              </Group>
              <Tooltip label="Обновить" withArrow>
                <ActionIcon
                  variant="light"
                  color="brand"
                  size="lg"
                  radius="md"
                  onClick={() => void load(true)}
                  loading={refreshing}
                  aria-label="Обновить данные канала"
                >
                  <IconRefresh size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Paper>

          {/* ⚠️ Прямо говорим, чего тут нет и как это получить. Без такой строки
              человек ищет удержание, не находит и считает, что раздел сломан. */}
          <Alert color="blue" variant="light" icon={<IconAlertCircle size={16} />}>
            <Text size="sm">
              Канал привязан по ссылке — вижу только публичные данные: ролики,
              просмотры, лайки и комментарии. Удержание, CTR превью, источники
              трафика и разбор канала по параметрам YouTube отдаёт лишь владельцу.
            </Text>
            <Button
              component={Link}
              href={`${settingsHref}?tab=integrations`}
              size="compact-sm"
              variant="light"
              color="brand"
              mt="xs"
              leftSection={<IconPlugConnected size={15} />}
            >
              Подключить через Google
            </Button>
          </Alert>

          {/* Вопросы зрителей работают и без OAuth: комментарии публичны. Это
              самый ценный блок в таком режиме — темы словами самой аудитории. */}
          {projectId && <AudienceQuestions projectId={projectId} />}

          <Paper className="an-surface" p="md" radius="lg">
            <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
              <Group gap="xs">
                <Text fw={600}>Ролики канала</Text>
                <Text size="xs" c="dimmed">
                  медиана канала — {formatCount(stats.medianViews)} просмотров
                </Text>
              </Group>
              {/* Тот же приём, что «Слабый CTR» у OAuth-дашборда: в чат уходит
                  список РЕАЛЬНЫХ роликов с цифрами, а не просьба «дай названия». */}
              {stats.videos.length > 0 && (
                <Button
                  size="compact-sm"
                  variant="light"
                  color="brand"
                  leftSection={<IconPencil size={15} />}
                  onClick={() => {
                    writeThumbTextsPrompt(
                      userId,
                      stats.videos.slice(0, 8).map((v) => ({ title: v.title, views: v.views }))
                    );
                    router.push(`/${projectId}/chat`);
                  }}
                >
                  Переписать упаковку с ассистентом
                </Button>
              )}
            </Group>

            {stats.videos.length === 0 ? (
              <Text size="sm" c="dimmed">
                Роликов не видно. Бывает, если канал совсем новый или ролики скрыты.
              </Text>
            ) : (
              <SimpleGrid cols={{ base: 1, xs: 2, md: 3, xl: 4 }} spacing="md">
                {stats.videos.map((v) => {
                  // Кратность к медиане КАНАЛА, а не к абстрактной норме:
                  // сравниваем ролик с тем, что этот канал обычно выдаёт.
                  const ratio = stats.medianViews > 0 ? v.views / stats.medianViews : 0;
                  const strong = ratio >= 2;
                  const weak = ratio > 0 && ratio < 0.5;
                  return (
                    <Box key={v.id}>
                      <Anchor
                        href={`https://www.youtube.com/watch?v=${v.id}`}
                        target="_blank"
                        rel="noreferrer"
                        underline="never"
                      >
                        <Box
                          className="yt-thumb"
                          style={{
                            position: "relative",
                            aspectRatio: "16 / 9",
                            borderRadius: 10,
                            overflow: "hidden",
                            background: "var(--mantine-color-default-hover)",
                          }}
                        >
                          {v.thumbnail && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={ytImage(v.thumbnail) ?? undefined}
                              alt=""
                              loading="lazy"
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          )}
                          {ratio > 0 && (strong || weak) && (
                            <Badge
                              size="sm"
                              radius="sm"
                              color={strong ? "teal" : "red"}
                              style={{ position: "absolute", left: 6, top: 6 }}
                            >
                              ×{ratio.toFixed(1)} к медиане
                            </Badge>
                          )}
                        </Box>
                        <Text size="sm" mt={6} lineClamp={2} c="var(--mantine-color-text)">
                          {v.title}
                        </Text>
                      </Anchor>
                      <Group justify="space-between" wrap="nowrap" mt={2} gap={4}>
                        <Text size="xs" c="dimmed" style={{ minWidth: 0 }} truncate>
                          {formatCount(v.views)} просмотров · {formatCount(v.likes)} лайков ·{" "}
                          {formatCount(v.comments)} комментариев
                        </Text>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="brand"
                          leftSection={<IconSparkles size={13} />}
                          style={{ flexShrink: 0 }}
                          onClick={() => setAnalyzeVideo(v)}
                        >
                          Разобрать
                        </Button>
                      </Group>
                    </Box>
                  );
                })}
              </SimpleGrid>
            )}
          </Paper>
        </>
      )}

      <Modal
        opened={analyzeVideo !== null}
        onClose={() => setAnalyzeVideo(null)}
        title={analyzeVideo?.title ?? ""}
        size="lg"
        radius="lg"
      >
        {analyzeVideo && <AnalysisPanel projectId={projectId} videoId={analyzeVideo.id} />}
      </Modal>
    </Stack>
  );
}
