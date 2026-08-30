"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";
import { ytImage } from "@/lib/image-proxy";
import { formatCount } from "@/lib/youtube-client";
import { apiChannelVideosForLink } from "@/lib/content-plan-client";
import { apiRefFromChannel } from "@/lib/thumbnails-client";
import type { LinkVideo } from "@/lib/content-plan";
import type { ThumbnailRow } from "@/lib/thumbnails";

// Превью уже вышедших роликов канала → стиль-референсы генератора.
//
// ⚠️ Зачем: у канала есть сложившийся вид обложек, и новое превью должно его
// ПРОДОЛЖАТЬ. Механизм стиль-референсов в генераторе давно есть, но кормить его
// приходилось руками: найти ролик, скачать картинку, залить файлом. Никто этого
// не делал — стили пустовали, и каждая генерация начинала дизайн с нуля.
//
// Список роликов — тот же, что у контент-плана (работает и для OAuth-канала, и
// для привязанного по ссылке). Ни квоты тарифа, ни units: превью публичны и
// качаются по id ролика.
export default function ChannelThumbsModal({
  projectId,
  opened,
  onClose,
  onAdded,
  room,
}: {
  projectId: string;
  opened: boolean;
  onClose: () => void;
  /** Импортированный референс — родитель кладёт его в общий список. */
  onAdded: (row: ThumbnailRow) => void;
  /** Сколько слотов референсов осталось (потолок MAX_REFERENCES общий). */
  room: number;
}) {
  const [videos, setVideos] = useState<LinkVideo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // id роликов: какие сейчас качаются и какие уже добавлены в этой сессии.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!opened) return;
    let alive = true;
    setError(null);
    void apiChannelVideosForLink(projectId).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setError(res.error);
        setVideos([]);
        return;
      }
      setVideos(res.data.connected ? res.data.videos : []);
    });
    return () => {
      alive = false;
    };
  }, [opened, projectId]);

  const importThumb = async (v: LinkVideo) => {
    if (busy.has(v.id) || added.has(v.id) || room <= 0) return;
    setBusy((s) => new Set(s).add(v.id));
    setError(null);
    const res = await apiRefFromChannel(projectId, v.id, v.title);
    setBusy((s) => {
      const next = new Set(s);
      next.delete(v.id);
      return next;
    });
    if (res.ok) {
      setAdded((s) => new Set(s).add(v.id));
      onAdded(res.data.item);
    } else {
      setError(res.error);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Превью с канала" size="xl" radius="lg">
      <Text size="sm" c="dimmed" mb="md">
        Выберите обложки, на которые новое превью должно быть похоже, — они станут
        стиль-референсами. Можно закрепить референс в списке ниже, и все новые превью
        будут держать этот вид.
      </Text>
      {/* ⚠️ Сразу разводим стиль и личность: без этой строки человек ждёт, что
          вместе с обложкой «возьмётся» и спикер с неё, — а лицо переносится только
          с чистого фото роли «Спикер» (на обложке оно мелкое и в плашках). */}
      <Text size="xs" c="dimmed" mb="md">
        Обложки передают ВИД превью (раскладку, палитру, подачу), но не лицо спикера —
        его модель берёт только из «Фото спикера». Хотите того же человека в кадре —
        добавьте его чистое фото отдельно.
      </Text>

      {error && (
        <Alert color="orange" variant="light" icon={<IconAlertCircle size={16} />} mb="sm">
          {error}
        </Alert>
      )}
      {room <= 0 && (
        <Alert color="orange" variant="light" mb="sm">
          Свободных слотов референсов нет — удалите лишние в блоке «Фото и стили проекта».
        </Alert>
      )}

      {videos === null ? (
        <Center py={48}>
          <Loader color="brand" />
        </Center>
      ) : videos.length === 0 ? (
        <Text size="sm" c="dimmed">
          Роликов канала не видно. Подключите канал в настройках проекта — через Google или
          по ссылке.
        </Text>
      ) : (
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
          {videos.map((v) => {
            const done = added.has(v.id);
            return (
              <UnstyledButton
                key={v.id}
                onClick={() => void importThumb(v)}
                disabled={done || room <= 0}
                aria-label={`Взять превью: ${v.title}`}
              >
                <Box
                  style={{
                    position: "relative",
                    aspectRatio: "16 / 9",
                    borderRadius: 10,
                    overflow: "hidden",
                    background: "var(--mantine-color-default-hover)",
                    outline: done ? "2px solid var(--mantine-color-teal-6)" : undefined,
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
                  {busy.has(v.id) && (
                    <Center
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(0,0,0,.45)",
                      }}
                    >
                      <Loader size="sm" color="brand" />
                    </Center>
                  )}
                  {done && (
                    <Badge
                      size="sm"
                      color="teal"
                      leftSection={<IconCheck size={12} />}
                      style={{ position: "absolute", right: 6, top: 6 }}
                    >
                      добавлено
                    </Badge>
                  )}
                </Box>
                <Text size="xs" mt={4} lineClamp={2}>
                  {v.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatCount(v.views)} просмотров
                </Text>
              </UnstyledButton>
            );
          })}
        </SimpleGrid>
      )}

      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose}>
          Готово
        </Button>
      </Group>
    </Modal>
  );
}
