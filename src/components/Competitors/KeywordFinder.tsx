"use client";

import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronUp,
  IconHelpCircle,
  IconPlus,
  IconSparkles,
} from "@tabler/icons-react";
import { apiKeywordStats, apiKeywordSuggestions } from "@/lib/keywords-client";
import {
  COMPETITION_LABEL,
  DEMAND_LABEL,
  MAX_STATS_QUERIES,
  VERDICT_COLOR,
  VERDICT_LABEL,
  keywordVerdict,
  reachLabel,
  type KeywordStats,
} from "@/lib/keywords";
import { formatCount } from "@/lib/youtube-client";

// Подбор ключевых слов — инструмент того же класса, что keyword research у vidIQ,
// встроенный прямо в поиск референсов: подобрал фразы → часть из них ушла в поле
// запросов, по которым раздел и ищет чужие ролики.
//
// ⚠️ Ни квоты тарифа, ни units YouTube это не тратит: подсказки берутся из
// автодополнения (в Data API его нет вовсе), конкуренция — со страницы выдачи (в
// API это 100 units за запрос). Поэтому крутить подбор можно сколько угодно, в
// отличие от самого поиска роликов.
//
// ⚠️ «Объёма поиска», как у vidIQ, тут НЕТ И НЕ БУДЕТ — сколько раз в месяц ищут
// запрос, YouTube не сообщает никому, а их цифра это собственная оценка по своей
// модели. Мы вместо неё показываем два ЧЕСТНЫХ сигнала: порядок подсказок (что
// YouTube предлагает первым) и медиану просмотров тех, кто уже в топе.
export default function KeywordFinder({
  onPick,
  /** Сколько фраз ещё влезет в поле запросов (лимит поиска). */
  slotsLeft,
}: {
  onPick: (phrase: string) => void;
  slotsLeft: number;
}) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, KeywordStats>>({});
  const [rating, setRating] = useState(false);
  // Свои слова, введённые руками: их тоже надо уметь взвесить, а не только то,
  // что предложил YouTube. Ровно этого не хватало на канале про Minecraft — там
  // человек заранее знает свои ключи («майнкрафт, minecraft, klauncher»).
  const [manual, setManual] = useState<string[]>([]);

  const suggest = async () => {
    const q = seed.trim();
    if (!q || loading) return;
    setLoading(true);
    setChecked([]);
    const list = await apiKeywordSuggestions(q);
    setSuggestions(list);
    setLoading(false);
  };

  /** Взвесить то, что введено в поле — хоть одно слово, хоть список через запятую. */
  const rateOwn = async () => {
    const own = seed
      .split(/[,;\n]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, MAX_STATS_QUERIES);
    if (own.length === 0 || rating) return;

    setManual((cur) => {
      const seen = new Set(cur.map((x) => x.toLowerCase()));
      return [...cur, ...own.filter((x) => !seen.has(x.toLowerCase()))];
    });
    setRating(true);
    const rows = await apiKeywordStats(own);
    setStats((cur) => {
      const next = { ...cur };
      for (const row of rows) next[row.query] = row;
      return next;
    });
    setRating(false);
  };

  const rate = async () => {
    if (checked.length === 0 || rating) return;
    setRating(true);
    const rows = await apiKeywordStats(checked);
    setStats((cur) => {
      const next = { ...cur };
      for (const row of rows) next[row.query] = row;
      return next;
    });
    setRating(false);
  };

  const toggle = (phrase: string) => {
    setChecked((cur) =>
      cur.includes(phrase)
        ? cur.filter((p) => p !== phrase)
        : cur.length >= MAX_STATS_QUERIES
          ? cur
          : [...cur, phrase]
    );
  };

  return (
    <Box>
      <Group gap="xs">
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<IconSparkles size={15} />}
          rightSection={open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          onClick={() => setOpen((v) => !v)}
        >
          Подобрать ключевые слова
        </Button>
        {!open && (
          <Text size="xs" c="dimmed">
            Что люди дописывают в поиске и насколько там занято
          </Text>
        )}
      </Group>

      <Collapse in={open}>
        <Stack gap="sm" pt="sm">
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <TextInput
              size="sm"
              style={{ flex: 1 }}
              placeholder="Тема или начало запроса: ремонт мерседес"
              value={seed}
              onChange={(e) => setSeed(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void suggest();
                }
              }}
            />
            <Button size="sm" h={36} onClick={() => void suggest()} loading={loading}>
              Подобрать
            </Button>
            {/* Свои ключи человек часто знает заранее — тогда подбор ему не нужен,
                нужен вес: насколько слово широкое и есть ли там зритель. */}
            <Tooltip label="Взвесить то, что введено (можно через запятую)" withArrow>
              <Button
                size="sm"
                h={36}
                variant="light"
                onClick={() => void rateOwn()}
                loading={rating}
                disabled={!seed.trim()}
              >
                Взвесить
              </Button>
            </Tooltip>
          </Group>

          {suggestions !== null && suggestions.length === 0 && !loading && (
            <Text size="sm" c="dimmed">
              По этой фразе подсказок нет. Попробуй короче или другими словами — так же, как
              её набирал бы зритель.
            </Text>
          )}

          {(manual.length > 0 || (suggestions && suggestions.length > 0)) && (
            <Stack gap={6}>
              <Group gap="xs" justify="space-between">
                <Text size="xs" c="dimmed">
                  {manual.length > 0 && !suggestions?.length
                    ? "Твои ключи"
                    : "Твои ключи и подсказки YouTube — сверху те, что предлагаются первыми"}
                </Text>
                <Group gap={6} wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    выбрано {checked.length} из {MAX_STATS_QUERIES}
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="light"
                    onClick={() => void rate()}
                    loading={rating}
                    disabled={checked.length === 0}
                  >
                    Оценить
                  </Button>
                </Group>
              </Group>

              <Stack gap={4}>
                {[...manual, ...(suggestions ?? [])].map((phrase) => {
                  const s = stats[phrase];
                  const v = s ? keywordVerdict(s) : null;
                  return (
                    <Group
                      key={phrase}
                      gap="xs"
                      wrap="nowrap"
                      align="center"
                      style={{
                        padding: "6px 8px",
                        borderRadius: 8,
                        background: "var(--mantine-color-default)",
                      }}
                    >
                      <Checkbox
                        size="xs"
                        checked={checked.includes(phrase)}
                        onChange={() => toggle(phrase)}
                        aria-label={`Оценить «${phrase}»`}
                      />
                      <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate title={phrase}>
                        {phrase}
                      </Text>

                      {rating && checked.includes(phrase) && !s && <Loader size={14} />}

                      {s && v && (
                        <Group gap={6} wrap="nowrap">
                          <Tooltip
                            withArrow
                            multiline
                            w={260}
                            label={`${v.hint} Роликов по запросу: ${formatCount(
                              s.totalResults
                            )} (${COMPETITION_LABEL[v.competition]}). В топе смотрят в среднем ${formatCount(
                              s.medianViews
                            )} раз — ${DEMAND_LABEL[v.demand]}.`}
                          >
                            <Badge size="sm" color={VERDICT_COLOR[v.verdict]} variant="light">
                              {VERDICT_LABEL[v.verdict]}
                            </Badge>
                          </Tooltip>
                          {/* Две цифры, по которым вердикт и собран: сколько уже
                              снято и сколько на этом смотрят. */}
                          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                            {reachLabel(s.totalResults)} · {formatCount(s.totalResults)} роликов ·
                            топ {formatCount(s.medianViews)}
                          </Text>
                        </Group>
                      )}

                      <Tooltip
                        label={slotsLeft > 0 ? "В запросы поиска" : "Запросы поиска заполнены"}
                        withArrow
                      >
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          disabled={slotsLeft <= 0}
                          aria-label="Добавить в запросы поиска"
                          onClick={() => onPick(phrase)}
                        >
                          <IconPlus size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  );
                })}
              </Stack>

              <Group gap={4} wrap="nowrap" align="flex-start">
                <IconHelpCircle
                  size={13}
                  style={{ color: "var(--mantine-color-dimmed)", marginTop: 2, flexShrink: 0 }}
                />
                {/* ⚠️ Формулировка намеренно честная: «объём поиска» тут не
                    показывается, потому что таких данных нет ни у кого, кроме
                    самого YouTube. Выдумывать цифру, как это делают инструменты
                    вокруг, мы не будем. */}
                <Text size="xs" c="dimmed">
                  Точного числа запросов в месяц YouTube не сообщает никому, поэтому его тут и
                  нет. Спрос виден по порядку подсказок, а живая ниша или мёртвая — по тому,
                  сколько просмотров у тех, кто уже в топе.
                </Text>
              </Group>
            </Stack>
          )}
        </Stack>
      </Collapse>
    </Box>
  );
}
