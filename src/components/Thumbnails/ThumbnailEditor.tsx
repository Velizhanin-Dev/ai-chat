"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconCheck,
  IconDownload,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import {
  AUDIENCE_PRESETS,
  EMPTY_SPEC,
  SPEC_LIMITS,
  THUMBNAIL_GENERATE_QUOTA_COST,
  type ThumbnailRow,
  type ThumbnailSpec,
} from "@/lib/thumbnails";
import { apiGenerateThumbnail } from "@/lib/thumbnails-client";
import { useAppDispatch } from "@/store/hooks";
import { bumpRequestsUsed } from "@/store/authSlice";
import YouTubeCard from "./YouTubeCard";
import { apiYouTubeStatus } from "@/lib/youtube-client";

// Редактор одного превью: картинка + правки + перегенерация. Каждая перегенерация
// — ВАРИАЦИЯ (parentId), поэтому старые версии не теряются и переключаются лентой
// снизу. Быстрые правки — это те же поля спеки, но названные человеческим языком.

// Готовые правки в один клик: дописываются к инструкциям кадра.
const QUICK_FIXES = [
  { label: "Крупнее лицо", patch: "Speaker's face much larger, tight crop." },
  { label: "Текст крупнее", patch: "Make the on-image text noticeably bigger and bolder." },
  { label: "Проще фон", patch: "Simplify the background, remove clutter." },
  { label: "Ярче цвета", patch: "Push contrast and color saturation higher." },
  { label: "Убрать лишнее", patch: "Remove secondary objects, keep one clear idea." },
];

interface Props {
  projectId: string;
  // Все превью группы (корень + вариации), свежие первыми. Пусто — модалка закрыта.
  variants: ThumbnailRow[];
  opened: boolean;
  onClose: () => void;
  references: ThumbnailRow[];
  onCreated: (row: ThumbnailRow) => void;
  onDelete: (id: string) => void;
}

export default function ThumbnailEditor({
  projectId,
  variants,
  opened,
  onClose,
  references,
  onCreated,
  onDelete,
}: Props) {
  // Канал для карточки ленты: если YouTube подключён — показываем реальные имя и
  // аватар, иначе нейтральную заглушку. Ошибку глушим: предпросмотр важнее.
  const [channel, setChannel] = useState<{ title: string; thumbnail: string | null } | null>(null);
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    void (async () => {
      const res = await apiYouTubeStatus(projectId);
      if (cancelled || !res.ok || !res.data.channel) return;
      setChannel({
        title: res.data.channel.title,
        thumbnail: res.data.channel.thumbnail ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [opened, projectId]);

  const isMobile = useMediaQuery("(max-width: 48em)");
  const dispatch = useAppDispatch();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [spec, setSpec] = useState<ThumbnailSpec>(EMPTY_SPEC);
  const [refIds, setRefIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = useMemo(
    () => variants.find((v) => v.id === activeId) ?? variants[0] ?? null,
    [variants, activeId]
  );

  // При открытии (и при появлении новой вариации) показываем самую свежую версию
  // и подтягиваем её спеку в форму правок.
  useEffect(() => {
    if (!opened || variants.length === 0) return;
    setActiveId(variants[0].id);
    setSpec(variants[0].spec ?? EMPTY_SPEC);
    setRefIds(variants[0].refIds ?? []);
    setError(null);
  }, [opened, variants]);

  const set = <K extends keyof ThumbnailSpec>(key: K, value: ThumbnailSpec[K]) =>
    setSpec((s) => ({ ...s, [key]: value }));

  const pickVersion = (row: ThumbnailRow) => {
    setActiveId(row.id);
    setSpec(row.spec ?? EMPTY_SPEC);
    setRefIds(row.refIds ?? []);
  };

  const addFix = (patch: string) =>
    setSpec((s) => ({
      ...s,
      instructions: s.instructions ? `${s.instructions}\n${patch}` : patch,
    }));

  const regenerate = async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      // Корень группы — исходное превью; сервер сам приведёт цепочку к корню.
      const row = await apiGenerateThumbnail(projectId, spec, refIds, active.parentId ?? active.id);
      dispatch(bumpRequestsUsed(THUMBNAIL_GENERATE_QUOTA_COST)); // остаток квоты в шапке не отстаёт
      onCreated(row);
      setActiveId(row.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось перерисовать превью");
    } finally {
      setBusy(false);
    }
  };

  if (!active) return null;

  const styles = references.filter((r) => r.role === "style");

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs" wrap="nowrap">
          <Text fw={600}>Превью</Text>
          {variants.length > 1 && (
            <Badge variant="light" color="gray" radius="sm">
              {variants.length} версии
            </Badge>
          )}
        </Group>
      }
      size="xl"
      radius="lg"
      fullScreen={isMobile}
    >
      <Stack gap="md">
        {error && (
          <Alert
            color="red"
            icon={<IconAlertCircle size={16} />}
            withCloseButton
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}

        <Group align="flex-start" gap="lg" wrap="wrap">
          {/* Картинка + версии */}
          <Box style={{ flex: "1 1 340px", minWidth: 0 }}>
            {/* Результат — карточкой ленты YouTube: превью живёт не само по себе, а
                рядом с названием, аватаркой и служебной строкой. Только в этом
                окружении видно, читается ли текст в реальном размере и не
                дублирует ли он название. */}
            <YouTubeCard
              src={active.url}
              title={active.spec?.videoTitle?.trim() || ""}
              channel={channel?.title || "Твой канал"}
              avatarUrl={channel?.thumbnail}
              duration="12:04"
            />
            <Text size="xs" c="dimmed" mt={6}>
              Так это увидит зритель в ленте
            </Text>

            <Group gap="xs" mt="sm">
              <Button
                component="a"
                href={active.url}
                download
                variant="light"
                color="brand"
                size="sm"
                leftSection={<IconDownload size={16} />}
              >
                Скачать
              </Button>
              <Tooltip label="Удалить эту версию" withArrow>
                <Button
                  variant="subtle"
                  color="red"
                  size="sm"
                  leftSection={<IconTrash size={16} />}
                  onClick={() => onDelete(active.id)}
                >
                  Удалить
                </Button>
              </Tooltip>
            </Group>

            {variants.length > 1 && (
              <Box mt="md">
                <Text size="xs" c="dimmed" mb={6}>
                  Версии
                </Text>
                <SimpleGrid cols={{ base: 4, sm: 5 }} spacing="xs">
                  {variants.map((v) => (
                    <UnstyledButton key={v.id} onClick={() => pickVersion(v)}>
                      <Box
                        style={{
                          aspectRatio: "16 / 9",
                          borderRadius: 8,
                          overflow: "hidden",
                          outline:
                            v.id === active.id
                              ? "2px solid var(--mantine-color-brand-6)"
                              : "1px solid var(--mantine-color-default-border)",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={v.url}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      </Box>
                    </UnstyledButton>
                  ))}
                </SimpleGrid>
              </Box>
            )}
          </Box>

          {/* Правки */}
          <Stack gap="sm" style={{ flex: "1 1 320px", minWidth: 0 }}>
            <Box>
              <Text size="sm" fw={500} mb={6}>
                Быстрые правки
              </Text>
              <Group gap={6}>
                {QUICK_FIXES.map((f) => (
                  <Button
                    key={f.label}
                    size="compact-sm"
                    variant="default"
                    radius="xl"
                    onClick={() => addFix(f.patch)}
                  >
                    {f.label}
                  </Button>
                ))}
              </Group>
            </Box>

            <TextInput
              label="Текст на превью"
              maxLength={SPEC_LIMITS.thumbText}
              value={spec.thumbText}
              onChange={(e) => set("thumbText", e.currentTarget.value)}
            />
            <Group grow align="flex-start">
              <TextInput
                label="Эмоция"
                maxLength={SPEC_LIMITS.emotion}
                value={spec.emotion}
                onChange={(e) => set("emotion", e.currentTarget.value)}
              />
              <TextInput
                label="Что ещё в кадре"
                maxLength={SPEC_LIMITS.supportObject}
                value={spec.supportObject}
                onChange={(e) => set("supportObject", e.currentTarget.value)}
              />
            </Group>
            <Textarea
              label="Что поправить"
              description="Своими словами: что не так и как должно быть."
              autosize
              minRows={2}
              maxRows={6}
              maxLength={SPEC_LIMITS.instructions}
              value={spec.instructions}
              onChange={(e) => set("instructions", e.currentTarget.value)}
            />

            <Box>
              <Text size="sm" fw={500} mb={6}>
                Под кого превью
              </Text>
              <SegmentedControl
                color="brand"
                fullWidth
                size="xs"
                value={spec.audiencePreset}
                onChange={(v) => set("audiencePreset", v)}
                data={AUDIENCE_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
              />
            </Box>

            {styles.length > 0 && (
              <Box>
                <Text size="sm" fw={500} mb={6}>
                  Стиль-референс
                </Text>
                <SimpleGrid cols={4} spacing="xs">
                  {styles.map((r) => {
                    const on = refIds.includes(r.id);
                    return (
                      <UnstyledButton
                        key={r.id}
                        onClick={() =>
                          setRefIds((p) =>
                            p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]
                          )
                        }
                        aria-pressed={on}
                      >
                        <Box
                          style={{
                            position: "relative",
                            aspectRatio: "16 / 9",
                            borderRadius: 8,
                            overflow: "hidden",
                            outline: on
                              ? "2px solid var(--mantine-color-brand-6)"
                              : "1px solid var(--mantine-color-default-border)",
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={r.url}
                            alt=""
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              display: "block",
                            }}
                          />
                          {on && (
                            <ThemeIcon
                              size="xs"
                              radius="xl"
                              color="brand"
                              variant="filled"
                              style={{ position: "absolute", top: 3, right: 3 }}
                            >
                              <IconCheck size={10} />
                            </ThemeIcon>
                          )}
                        </Box>
                      </UnstyledButton>
                    );
                  })}
                </SimpleGrid>
              </Box>
            )}

            <Paper className="an-surface" radius="md" p="sm">
              <Button
                fullWidth
                color="brand"
                leftSection={<IconRefresh size={16} />}
                onClick={regenerate}
                loading={busy}
              >
                Перерисовать
              </Button>
              <Text size="xs" c="dimmed" ta="center" mt={6}>
                Новая версия, старая останется. 1 запрос из тарифа.
              </Text>
            </Paper>
          </Stack>
        </Group>
      </Stack>
    </Modal>
  );
}
