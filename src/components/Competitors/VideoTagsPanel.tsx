"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Collapse,
  CopyButton,
  Group,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconHelpCircle,
  IconTag,
} from "@tabler/icons-react";
import { useAppDispatch } from "@/store/hooks";
import { bumpRequestsUsed } from "@/store/authSlice";
import { apiGenerateVideoTags } from "@/lib/keywords-client";
import {
  TAG_GROUP_META,
  TAG_TOPIC_MAX_LENGTH,
  VIDEO_TAGS_QUOTA_COST,
  YT_TAGS_MAX_CHARS,
  tagsForClipboard,
  type TagGroup,
  type TagRow,
  type VideoTagSet,
} from "@/lib/video-tags";
import { formatCount } from "@/lib/youtube-client";

// Теги для СВОЕГО ролика по схеме продюсеров студии: 10 охватных (их ищут все,
// конкуренция высокая) + 8 свободных (ищут, а роликов мало) + 2 именных.
//
// ⚠️⚠️ Каждая фраза в итоге прошла замер через страницу выдачи YouTube: рядом с
// тегом стоит охват (сколько просмотров собрала первая страница выдачи по этому
// запросу) и число роликов по нему. Подсказки YouTube и теги чужих роликов сюда
// попадают только кандидатами — продюсеры прямо говорят, что «родные» теги
// YouTube часто плохие, поэтому раскладка идёт по цифрам, а не по источнику.
//
// ⚠️ Стоит VIDEO_TAGS_QUOTA_COST запросов квоты (один вызов модели за кандидатов);
// сам замер units YouTube не тратит.

const GROUPS: TagGroup[] = ["reach", "gap", "brand"];

function rowTitle(r: TagRow): string {
  if (r.totalResults === null) {
    return "Замерить не удалось — YouTube сейчас не отдал выдачу по этой фразе, цифр нет.";
  }
  const parts = [
    `Роликов по запросу: ${formatCount(r.totalResults)}`,
    `Охват первой страницы выдачи: ${formatCount(r.topViews ?? 0)} просмотров`,
    `В топе смотрят в среднем ${formatCount(r.medianViews ?? 0)} раз`,
  ];
  if (r.suggested) parts.push("Фразу дописывают в поиске YouTube");
  if (r.source === "niche") parts.push("Так размечают ролики, которые в нише выстрелили");
  return parts.join(" · ");
}

function TagChip({ row, group }: { row: TagRow; group: TagGroup }) {
  const measured = row.totalResults !== null;
  return (
    <Tooltip label={rowTitle(row)} withArrow multiline w={280}>
      <Group
        gap={6}
        wrap="nowrap"
        align="center"
        style={{
          padding: "5px 8px",
          borderRadius: 8,
          background: "var(--mantine-color-default)",
          borderLeft: `3px solid ${
            group === "reach"
              ? "var(--mantine-color-brand-filled)"
              : group === "gap"
                ? "var(--mantine-color-teal-filled)"
                : "var(--mantine-color-gray-5)"
          }`,
        }}
      >
        <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate>
          {row.tag}
        </Text>
        {/* Именные не замеряем — у них цифры не про то. У остальных две цифры,
            по которым тег и попал в группу: охват и сколько по нему роликов. */}
        {group !== "brand" && (
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            {measured
              ? `${formatCount(row.topViews ?? 0)} · ${formatCount(row.totalResults ?? 0)} видео`
              : "без цифр"}
          </Text>
        )}
      </Group>
    </Tooltip>
  );
}

export default function VideoTagsPanel({
  projectId,
  /** Верхние ролики текущей выдачи — их теги идут кандидатами. */
  refIds,
}: {
  projectId: string;
  refIds: string[];
}) {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [set, setSet] = useState<VideoTagSet | null>(null);

  const generate = async () => {
    const t = topic.trim();
    if (!t || loading || !projectId) return;
    setLoading(true);
    setError(null);
    const res = await apiGenerateVideoTags({ projectId, topic: t, refIds });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSet(res.set);
    dispatch(bumpRequestsUsed(VIDEO_TAGS_QUOTA_COST)); // остаток квоты в шапке не отстаёт
  };

  const total = set ? set.reach.length + set.gap.length + set.brand.length : 0;
  const shortGroups = set
    ? GROUPS.filter((g) => set[g].length < TAG_GROUP_META[g].count).map(
        (g) => TAG_GROUP_META[g].label.toLowerCase()
      )
    : [];

  return (
    <Box>
      <Group gap="xs">
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<IconTag size={15} />}
          rightSection={open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          onClick={() => setOpen((v) => !v)}
        >
          Теги для своего ролика
        </Button>
        {!open && (
          <Text size="xs" c="dimmed">
            20 тегов по схеме студии: 10 охватных, 8 свободных, 2 именных — каждый с замером
          </Text>
        )}
      </Group>

      <Collapse in={open}>
        <Stack gap="sm" pt="sm">
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <TextInput
              size="sm"
              style={{ flex: 1 }}
              placeholder="О чём ролик или его название: болячки мотора M274"
              value={topic}
              maxLength={TAG_TOPIC_MAX_LENGTH}
              onChange={(e) => setTopic(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void generate();
                }
              }}
            />
            <Button
              size="sm"
              h={36}
              onClick={() => void generate()}
              loading={loading}
              disabled={!topic.trim()}
            >
              Собрать 20 тегов · {VIDEO_TAGS_QUOTA_COST}
            </Button>
          </Group>

          {loading && (
            <Text size="xs" c="dimmed">
              Собираю кандидатов и замеряю каждую фразу по выдаче YouTube — это около
              полуминуты.
            </Text>
          )}

          {error && (
            <Alert color="orange" icon={<IconAlertTriangle size={16} />} py="xs">
              {error}
            </Alert>
          )}

          {set && (
            <Stack gap="md">
              <Group justify="space-between" gap="xs" wrap="wrap">
                <Text size="xs" c="dimmed">
                  Замерено {set.measured} из {set.candidates} кандидатов
                  {set.failed > 0 ? `, ${set.failed} без цифр` : ""}. Всего тегов: {total} ·{" "}
                  <Text
                    span
                    fw={600}
                    c={set.chars > YT_TAGS_MAX_CHARS ? "red" : undefined}
                    title="Лимит поля тегов в YouTube Studio"
                  >
                    {set.chars} / {YT_TAGS_MAX_CHARS}
                  </Text>{" "}
                  символов
                </Text>
                <CopyButton value={tagsForClipboard(set)} timeout={1500}>
                  {({ copied, copy }) => (
                    <Button
                      size="compact-sm"
                      variant="light"
                      leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      onClick={copy}
                    >
                      {copied ? "Скопировано" : "Скопировать все теги"}
                    </Button>
                  )}
                </CopyButton>
              </Group>

              {GROUPS.map((g) => {
                const meta = TAG_GROUP_META[g];
                const rows = set[g];
                return (
                  <Stack key={g} gap={6}>
                    <Group gap={6} align="center">
                      <Text size="sm" fw={600}>
                        {meta.label} — {rows.length} из {meta.count}
                      </Text>
                      <Tooltip label={meta.hint} withArrow multiline w={280}>
                        <IconHelpCircle
                          size={14}
                          tabIndex={0}
                          aria-label={meta.hint}
                          style={{ color: "var(--mantine-color-dimmed)", cursor: "help" }}
                        />
                      </Tooltip>
                    </Group>
                    {rows.length === 0 ? (
                      <Text size="xs" c="dimmed">
                        Кандидатов для этой группы не нашлось.
                      </Text>
                    ) : (
                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={6} verticalSpacing={6}>
                        {rows.map((r) => (
                          <TagChip key={r.tag} row={r} group={g} />
                        ))}
                      </SimpleGrid>
                    )}
                  </Stack>
                );
              })}

              {shortGroups.length > 0 && (
                <Text size="xs" c="orange">
                  В группах «{shortGroups.join("», «")}» тегов меньше, чем по схеме: кандидатов с
                  подтверждённым спросом не хватило. Уточни тему или запусти поиск референсов —
                  теги его верхних роликов пойдут кандидатами.
                </Text>
              )}

              <Group gap={4} wrap="nowrap" align="flex-start">
                <IconHelpCircle
                  size={13}
                  style={{ color: "var(--mantine-color-dimmed)", marginTop: 2, flexShrink: 0 }}
                />
                {/* ⚠️ Та же честность, что в подборе ключей: точного числа запросов
                    в месяц у YouTube не взять никому, поэтому охват показан по
                    просмотрам первой страницы выдачи, а конкуренция — по числу роликов. */}
                <Text size="xs" c="dimmed">
                  Первая цифра у тега — сколько просмотров собрала первая страница выдачи по
                  этому запросу (охват), вторая — сколько роликов по нему уже есть
                  (конкуренция). Точного числа запросов в месяц YouTube не сообщает никому.
                  Вставляй список целиком в поле «Теги» в Studio.
                </Text>
              </Group>
            </Stack>
          )}
        </Stack>
      </Collapse>
    </Box>
  );
}
