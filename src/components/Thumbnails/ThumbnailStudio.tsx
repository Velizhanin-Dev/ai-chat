"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Grid,
  Group,
  Image,
  Loader,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBulb,
  IconDownload,
  IconPhoto,
  IconPhotoPlus,
  IconSparkles,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  AUDIENCE_PRESETS,
  EMPTY_SPEC,
  MAX_REFERENCES,
  MAX_REFERENCE_BYTES,
  REF_ROLE_LABEL,
  REF_SCORES,
  SPEC_LIMITS,
  isSpecReady,
  type RefRole,
  type ThumbnailIdeas,
  type ThumbnailRow,
  type ThumbnailSpec,
} from "@/lib/thumbnails";
import {
  apiDeleteThumbnail,
  apiGenerateThumbnail,
  apiListThumbnails,
  apiThumbnailIdeas,
  apiUploadReference,
} from "@/lib/thumbnails-client";
import { apiGetProjectBrief } from "@/lib/chat-client";

// Генератор превью проекта. Слева — что показать на превью (доп. инструкции для
// нейронки + референсы, с которых переносятся спикер и объекты), справа — история
// генераций. Отдельная кнопка «Предложить заголовки» гоняет текстовую модель по
// методике (ВИСП) и подставляет текст на превью в форму.

const ROLE_OPTIONS = (Object.keys(REF_ROLE_LABEL) as RefRole[]).map((r) => ({
  value: r,
  label: REF_ROLE_LABEL[r],
}));

export default function ThumbnailStudio({ projectId }: { projectId: string }) {
  const [spec, setSpec] = useState<ThumbnailSpec>(EMPTY_SPEC);
  const [items, setItems] = useState<ThumbnailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadRole, setUploadRole] = useState<RefRole>("speaker");
  const fileInput = useRef<HTMLInputElement>(null);

  const [generating, setGenerating] = useState(false);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideas, setIdeas] = useState<ThumbnailIdeas | null>(null);
  const [preview, setPreview] = useState<ThumbnailRow | null>(null);

  const set = <K extends keyof ThumbnailSpec>(key: K, value: ThumbnailSpec[K]) =>
    setSpec((s) => ({ ...s, [key]: value }));

  // История проекта + префилл ниши/ЦА из брифа (чтобы не вбивать это руками).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const rows = await apiListThumbnails(projectId);
        if (!cancelled) setItems(rows);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить историю");
      } finally {
        if (!cancelled) setLoading(false);
      }
      const brief = await apiGetProjectBrief(projectId);
      if (!cancelled && brief.ok) {
        setSpec((s) => ({
          ...s,
          niche: s.niche || brief.data.niche || "",
          audience: s.audience || brief.data.audience || "",
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const references = items.filter((i) => i.kind === "reference");
  const generations = items.filter((i) => i.kind === "generation");

  const onPickFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setError(null);
      setUploading(true);
      try {
        const room = MAX_REFERENCES - references.length;
        for (const file of Array.from(files).slice(0, Math.max(0, room))) {
          if (file.size > MAX_REFERENCE_BYTES) {
            throw new Error(
              `«${file.name}» больше ${Math.round(MAX_REFERENCE_BYTES / 1024 / 1024)} МБ`
            );
          }
          const row = await apiUploadReference(projectId, file, uploadRole);
          setItems((prev) => [row, ...prev]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить референс");
      } finally {
        setUploading(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    },
    [projectId, references.length, uploadRole]
  );

  const remove = async (id: string) => {
    setError(null);
    const before = items;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await apiDeleteThumbnail(projectId, id);
    } catch (e) {
      setItems(before);
      setError(e instanceof Error ? e.message : "Не удалось удалить");
    }
  };

  const suggest = async () => {
    setError(null);
    setIdeasLoading(true);
    try {
      setIdeas(await apiThumbnailIdeas(projectId, spec));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подобрать заголовки");
    } finally {
      setIdeasLoading(false);
    }
  };

  const generate = async () => {
    setError(null);
    setGenerating(true);
    try {
      // Порядок референсов = порядок Image 1..N в промпте: спикер первым.
      const ordered = [...references].sort((a, b) =>
        a.role === b.role ? 0 : a.role === "speaker" ? -1 : b.role === "speaker" ? 1 : 0
      );
      const row = await apiGenerateThumbnail(
        projectId,
        spec,
        ordered.map((r) => r.id)
      );
      setItems((prev) => [row, ...prev]);
      setPreview(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сгенерировать превью");
    } finally {
      setGenerating(false);
    }
  };

  const canGenerate = isSpecReady(spec) && !generating;

  return (
    <ScrollArea style={{ flex: 1, minHeight: 0 }}>
      <Box px={{ base: "sm", sm: "md" }} py="md" maw={1400} mx="auto">
        <Group justify="space-between" align="flex-start" mb="md" wrap="nowrap">
          <div>
            <Title order={2} fz={{ base: "1.35rem", sm: "1.75rem" }}>
              Генератор превью
            </Title>
            <Text c="dimmed" size="sm" mt={4}>
              Опиши, что показать в кадре, и загрузи фото — спикера и объекты перенесу с
              референсов. Собираю превью по методике: одна идея, крупный спикер, текст
              в 3-5 слов.
            </Text>
          </div>
        </Group>

        {error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />} mb="md" withCloseButton
            onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Grid gutter="lg">
          {/* ── Форма ── */}
          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Stack gap="md">
              <Paper withBorder radius="md" p="md">
                <Text fw={600} mb="xs">
                  Что показать на превью
                </Text>
                <Stack gap="sm">
                  <Textarea
                    label="Опиши кадр своими словами"
                    description="Главное поле. Например: «я стою у бетономешалки, показываю пальцем на лоток, на лице возмущение»."
                    placeholder="Что происходит в кадре, кто и что в нём есть"
                    autosize
                    minRows={3}
                    maxRows={8}
                    maxLength={SPEC_LIMITS.instructions}
                    value={spec.instructions}
                    onChange={(e) => set("instructions", e.currentTarget.value)}
                  />
                  <Textarea
                    label="О чём ролик"
                    description="Контекст для нейронки — по нему же подбираются заголовки."
                    autosize
                    minRows={2}
                    maxRows={6}
                    maxLength={SPEC_LIMITS.videoSummary}
                    value={spec.videoSummary}
                    onChange={(e) => set("videoSummary", e.currentTarget.value)}
                  />
                </Stack>
              </Paper>

              {/* ── Референсы ── */}
              <Paper withBorder radius="md" p="md">
                <Group justify="space-between" mb="xs" wrap="nowrap">
                  <div>
                    <Text fw={600}>Референсы</Text>
                    <Text size="xs" c="dimmed">
                      Спикер — переносится лицо один в один (без «улучшений»). Объект —
                      форма и цвет. Стиль — композиция целиком.
                    </Text>
                  </div>
                  <Badge variant="light" color="brand">
                    {references.length} / {MAX_REFERENCES}
                  </Badge>
                </Group>

                <Group gap="sm" mb="sm" wrap="nowrap" align="flex-end">
                  <Select
                    label="Роль следующего файла"
                    data={ROLE_OPTIONS}
                    value={uploadRole}
                    onChange={(v) => setUploadRole((v as RefRole) ?? "speaker")}
                    w={200}
                    comboboxProps={{ withinPortal: true }}
                  />
                  <Button
                    leftSection={<IconPhotoPlus size={16} />}
                    variant="light"
                    color="brand"
                    loading={uploading}
                    disabled={references.length >= MAX_REFERENCES}
                    onClick={() => fileInput.current?.click()}
                  >
                    Загрузить
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    hidden
                    onChange={(e) => void onPickFiles(e.currentTarget.files)}
                  />
                </Group>

                {references.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    Без референсов превью будет полностью нарисованным — по методике это
                    хуже: сгенерированные лица считываются как «ИИшные» и отпугивают.
                  </Text>
                ) : (
                  <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs">
                    {references.map((r) => (
                      <Box key={r.id} style={{ position: "relative" }}>
                        <Image
                          src={r.url}
                          alt={REF_ROLE_LABEL[r.role]}
                          radius="sm"
                          h={90}
                          fit="cover"
                        />
                        <Badge
                          size="xs"
                          variant="filled"
                          color="dark"
                          style={{ position: "absolute", left: 4, bottom: 4 }}
                        >
                          {REF_ROLE_LABEL[r.role]}
                        </Badge>
                        <Tooltip label="Удалить" withArrow>
                          <Box
                            component="button"
                            aria-label="Удалить референс"
                            onClick={() => void remove(r.id)}
                            style={{
                              position: "absolute",
                              top: 4,
                              right: 4,
                              border: 0,
                              borderRadius: 4,
                              cursor: "pointer",
                              lineHeight: 0,
                              padding: 2,
                              background: "rgba(0,0,0,.55)",
                              color: "#fff",
                            }}
                          >
                            <IconX size={13} />
                          </Box>
                        </Tooltip>
                      </Box>
                    ))}
                  </SimpleGrid>
                )}

                {references.some((r) => r.role === "style") && (
                  <Group gap="sm" mt="sm" align="flex-end" wrap="nowrap">
                    <Select
                      label="Насколько копировать стиль-референс"
                      data={REF_SCORES.map((s) => ({ value: s.value, label: s.label }))}
                      value={spec.refScore}
                      onChange={(v) => set("refScore", v ?? "1")}
                      w={280}
                      comboboxProps={{ withinPortal: true }}
                    />
                    {spec.refScore === "3" && (
                      <TextInput
                        label="Что именно скопировать"
                        placeholder="эмоцию / композицию / цвет"
                        style={{ flex: 1 }}
                        maxLength={SPEC_LIMITS.refElement}
                        value={spec.refElement}
                        onChange={(e) => set("refElement", e.currentTarget.value)}
                      />
                    )}
                  </Group>
                )}
              </Paper>

              {/* ── Текст на превью + заголовки от нейронки ── */}
              <Paper withBorder radius="md" p="md">
                <Group justify="space-between" mb="xs" wrap="nowrap">
                  <div>
                    <Text fw={600}>Текст на превью</Text>
                    <Text size="xs" c="dimmed">
                      3-5 слов. Не дублирует название ролика: превью — эмоция, название —
                      рацио и SEO.
                    </Text>
                  </div>
                  <Button
                    size="xs"
                    variant="light"
                    color="brand"
                    leftSection={<IconBulb size={15} />}
                    loading={ideasLoading}
                    disabled={!spec.videoSummary.trim() && !spec.instructions.trim()}
                    onClick={() => void suggest()}
                  >
                    Предложить по методике
                  </Button>
                </Group>

                <Group grow align="flex-start" gap="sm">
                  <TextInput
                    label="Текст"
                    placeholder="НЕДОВОЗ БЕТОНА"
                    maxLength={SPEC_LIMITS.thumbText}
                    value={spec.thumbText}
                    onChange={(e) => set("thumbText", e.currentTarget.value)}
                  />
                  <TextInput
                    label="Главное слово (капсом)"
                    placeholder="НЕДОВОЗ"
                    maxLength={SPEC_LIMITS.keyWord}
                    value={spec.keyWord}
                    onChange={(e) => set("keyWord", e.currentTarget.value)}
                  />
                </Group>
                <TextInput
                  mt="sm"
                  label="Название ролика"
                  description="Нужно, чтобы текст на превью его не повторял."
                  maxLength={SPEC_LIMITS.videoTitle}
                  value={spec.videoTitle}
                  onChange={(e) => set("videoTitle", e.currentTarget.value)}
                />

                {ideas && (
                  <Stack gap="xs" mt="md">
                    {ideas.thumbTexts.length > 0 && (
                      <div>
                        <Text size="sm" fw={600} mb={6}>
                          Варианты текста на превью
                        </Text>
                        <Stack gap={6}>
                          {ideas.thumbTexts.map((t, i) => (
                            <Card
                              key={i}
                              withBorder
                              radius="sm"
                              padding="xs"
                              style={{ cursor: "pointer" }}
                              onClick={() => {
                                set("thumbText", t.text);
                                set("keyWord", t.keyWord);
                              }}
                            >
                              <Text size="sm" fw={600}>
                                {t.text}
                              </Text>
                              {t.why && (
                                <Text size="xs" c="dimmed">
                                  {t.why}
                                </Text>
                              )}
                            </Card>
                          ))}
                        </Stack>
                      </div>
                    )}
                    {ideas.titles.length > 0 && (
                      <div>
                        <Text size="sm" fw={600} mb={6}>
                          Названия ролика по ВИСП
                        </Text>
                        <Stack gap={6}>
                          {ideas.titles.map((t, i) => (
                            <Card
                              key={i}
                              withBorder
                              radius="sm"
                              padding="xs"
                              style={{ cursor: "pointer" }}
                              onClick={() => set("videoTitle", t)}
                            >
                              <Text size="sm">{t}</Text>
                            </Card>
                          ))}
                        </Stack>
                      </div>
                    )}
                    {(ideas.supportObject || ideas.emotion || ideas.palette) && (
                      <Button
                        size="xs"
                        variant="subtle"
                        color="brand"
                        onClick={() => {
                          if (ideas.supportObject) set("supportObject", ideas.supportObject);
                          if (ideas.emotion) set("emotion", ideas.emotion);
                          if (ideas.palette) set("palette", ideas.palette);
                        }}
                      >
                        Подставить доп-элемент, эмоцию и палитру
                      </Button>
                    )}
                  </Stack>
                )}
              </Paper>

              {/* ── Кадр ── */}
              <Paper withBorder radius="md" p="md">
                <Text fw={600} mb="xs">
                  Кадр
                </Text>
                <Stack gap="sm">
                  <TextInput
                    label="Доп-элемент"
                    description="Ровно один, осмысленный. Одна превью — одна идея."
                    maxLength={SPEC_LIMITS.supportObject}
                    value={spec.supportObject}
                    onChange={(e) => set("supportObject", e.currentTarget.value)}
                  />
                  <TextInput
                    label="Эмоция и поза спикера"
                    placeholder="возмущение, палец в кадр"
                    maxLength={SPEC_LIMITS.emotion}
                    value={spec.emotion}
                    onChange={(e) => set("emotion", e.currentTarget.value)}
                  />
                  <TextInput
                    label="Палитра"
                    placeholder="красный + чёрный, жёлтый акцент"
                    maxLength={SPEC_LIMITS.palette}
                    value={spec.palette}
                    onChange={(e) => set("palette", e.currentTarget.value)}
                  />
                  <Group grow align="flex-start">
                    <Select
                      label="Стиль под ЦА"
                      data={AUDIENCE_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                      value={spec.audiencePreset}
                      onChange={(v) => set("audiencePreset", v ?? "neutral")}
                      comboboxProps={{ withinPortal: true }}
                      description={
                        AUDIENCE_PRESETS.find((p) => p.id === spec.audiencePreset)?.hint
                      }
                    />
                    <NumberInput
                      label="Людей в кадре"
                      description="Максимум 2 — лишние лица рассеивают взгляд."
                      min={0}
                      max={2}
                      clampBehavior="strict"
                      value={spec.peopleCount}
                      onChange={(v) => set("peopleCount", Number(v) || 0)}
                    />
                  </Group>
                  <Group grow align="flex-start">
                    <TextInput
                      label="Ниша"
                      maxLength={SPEC_LIMITS.niche}
                      value={spec.niche}
                      onChange={(e) => set("niche", e.currentTarget.value)}
                    />
                    <TextInput
                      label="ЦА"
                      maxLength={SPEC_LIMITS.audience}
                      value={spec.audience}
                      onChange={(e) => set("audience", e.currentTarget.value)}
                    />
                  </Group>
                </Stack>
              </Paper>

              <Button
                size="md"
                color="brand"
                leftSection={<IconSparkles size={18} />}
                loading={generating}
                disabled={!canGenerate}
                onClick={() => void generate()}
              >
                Сгенерировать превью
              </Button>
              <Text size="xs" c="dimmed" ta="center" mt={-8}>
                Одна генерация = 1 запрос из квоты. Занимает до минуты.
              </Text>
            </Stack>
          </Grid.Col>

          {/* ── История генераций ── */}
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Paper withBorder radius="md" p="md">
              <Text fw={600} mb="xs">
                Сгенерированные превью
              </Text>
              {loading ? (
                <Stack gap="xs">
                  <Skeleton h={120} radius="sm" />
                  <Skeleton h={120} radius="sm" />
                </Stack>
              ) : generations.length === 0 ? (
                <Stack align="center" gap="xs" py="xl">
                  <ThemeIcon color="brand" variant="light" radius="xl" size={44}>
                    <IconPhoto size={22} />
                  </ThemeIcon>
                  <Text c="dimmed" size="sm" ta="center">
                    Пока пусто. Сгенерируй 3 разных варианта и запусти А/Б-тест —
                    переделывать один по кругу бессмысленно.
                  </Text>
                </Stack>
              ) : (
                <SimpleGrid cols={{ base: 2, sm: 2 }} spacing="sm">
                  {generations.map((g) => (
                    <Card key={g.id} withBorder radius="sm" padding={0}>
                      <Image
                        src={g.url}
                        alt={g.label || "Превью"}
                        h={110}
                        fit="cover"
                        style={{ cursor: "zoom-in" }}
                        onClick={() => setPreview(g)}
                      />
                      <Group justify="space-between" p={6} wrap="nowrap" gap={4}>
                        <Text size="xs" truncate title={g.label}>
                          {g.label || "без текста"}
                        </Text>
                        <Group gap={2} wrap="nowrap">
                          <Tooltip label="Скачать" withArrow>
                            <Box
                              component="a"
                              href={g.url}
                              download={`thumbnail-${g.id}.jpg`}
                              style={{ lineHeight: 0, color: "var(--mantine-color-dimmed)" }}
                            >
                              <IconDownload size={15} />
                            </Box>
                          </Tooltip>
                          <Tooltip label="Удалить" withArrow>
                            <Box
                              component="button"
                              aria-label="Удалить превью"
                              onClick={() => void remove(g.id)}
                              style={{
                                border: 0,
                                background: "transparent",
                                cursor: "pointer",
                                lineHeight: 0,
                                padding: 0,
                                color: "var(--mantine-color-dimmed)",
                              }}
                            >
                              <IconTrash size={15} />
                            </Box>
                          </Tooltip>
                        </Group>
                      </Group>
                    </Card>
                  ))}
                </SimpleGrid>
              )}
              {generating && (
                <Group gap="xs" mt="md" justify="center">
                  <Loader size="xs" color="brand" />
                  <Text size="sm" c="dimmed">
                    Рисую превью…
                  </Text>
                </Group>
              )}
            </Paper>
          </Grid.Col>
        </Grid>
      </Box>

      <Modal
        opened={Boolean(preview)}
        onClose={() => setPreview(null)}
        size="xl"
        title={preview?.label || "Превью"}
        centered
      >
        {preview && (
          <Stack gap="sm">
            <Image src={preview.url} alt={preview.label || "Превью"} radius="sm" />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {preview.model}
              </Text>
              <Button
                component="a"
                href={preview.url}
                download={`thumbnail-${preview.id}.jpg`}
                size="xs"
                variant="light"
                color="brand"
                leftSection={<IconDownload size={15} />}
              >
                Скачать
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </ScrollArea>
  );
}
