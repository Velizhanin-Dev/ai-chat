"use client";

import { useState } from "react";
import {
  Accordion,
  Badge,
  Box,
  Button,
  Group,
  List,
  Progress,
  Stack,
  Text,
} from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import {
  BLOCK_META,
  FORMAT_META,
  type BlockKey,
  type ContentPlanView,
  type VideoView,
} from "@/lib/content-plan";

// Опорные блоки плана (Фаза 3): портреты ЦА, лестница Ханта, воронка, сетка
// шортсов. Каждый генерится по кнопке (стоимость — в BLOCK_META), пока не
// сгенерирован — показываем, зачем он нужен.

export default function SupportBlocks({
  plan,
  shorts,
  busy,
  onGenerate,
}: {
  plan: ContentPlanView;
  shorts: VideoView[];
  busy: BlockKey | null;
  onGenerate: (block: BlockKey) => void;
}) {
  const [open, setOpen] = useState<string[]>([]);

  const filled = (k: BlockKey): boolean =>
    k === "audience"
      ? Boolean(plan.audience?.length)
      : k === "hunt"
        ? Boolean(plan.huntLadder?.length)
        : shorts.length > 0;

  return (
    <Accordion
      variant="separated"
      radius="md"
      multiple
      value={open}
      onChange={setOpen}
      classNames={{ item: "an-acc-item" }}
    >
      {(Object.keys(BLOCK_META) as BlockKey[]).map((key) => {
        const meta = BLOCK_META[key];
        const has = filled(key);
        return (
          <Accordion.Item key={key} value={key}>
            <Accordion.Control>
              <Group gap={8} wrap="nowrap">
                <Text fw={600}>{meta.label}</Text>
                {has ? (
                  <Badge size="sm" variant="light" color="teal" radius="sm">
                    готово
                  </Badge>
                ) : (
                  <Badge size="sm" variant="light" color="gray" radius="sm">
                    не собран
                  </Badge>
                )}
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Text size="sm" c="dimmed">
                    {meta.hint}
                  </Text>
                  <Button
                    size="xs"
                    variant={has ? "default" : "light"}
                    color="brand"
                    leftSection={<IconSparkles size={14} />}
                    loading={busy === key}
                    disabled={busy !== null && busy !== key}
                    onClick={() => onGenerate(key)}
                    style={{ flexShrink: 0 }}
                  >
                    {has ? "Пересобрать" : "Собрать"} · {meta.cost}
                  </Button>
                </Group>

                {key === "audience" && plan.audience?.length ? (
                  <Stack gap="sm">
                    {plan.audience.map((p, i) => (
                      <Box key={i} className="cp-block">
                        <Group gap={8} align="baseline" wrap="wrap">
                          <Text fw={700}>{p.name}</Text>
                          {p.huntStage && (
                            <Badge size="xs" variant="light" color="brand" radius="sm">
                              {p.huntStage}
                            </Badge>
                          )}
                        </Group>
                        {p.who && (
                          <Text size="sm" c="dimmed">
                            {p.who}
                          </Text>
                        )}
                        {p.pains.length > 0 && (
                          <List size="sm" spacing={2} mt={6}>
                            {p.pains.map((x, j) => (
                              <List.Item key={j}>{x}</List.Item>
                            ))}
                          </List>
                        )}
                        {p.turnOff && (
                          <Text size="xs" c="dimmed" mt={6}>
                            Оттолкнёт: {p.turnOff}
                          </Text>
                        )}
                      </Box>
                    ))}
                  </Stack>
                ) : null}

                {key === "hunt" && plan.huntLadder?.length ? (
                  <Stack gap="sm">
                    {plan.huntLadder.map((h, i) => (
                      <Box key={i} className="cp-block">
                        <Group gap={8} align="baseline">
                          <Badge size="sm" color="brand" variant="filled" radius="xl">
                            {i + 1}
                          </Badge>
                          <Text fw={700}>{h.stage}</Text>
                        </Group>
                        {h.state && (
                          <Text size="sm" c="dimmed" mt={4}>
                            {h.state}
                          </Text>
                        )}
                        {h.thoughts.length > 0 && (
                          <List size="sm" spacing={2} mt={6}>
                            {h.thoughts.map((x, j) => (
                              <List.Item key={j}>{x}</List.Item>
                            ))}
                          </List>
                        )}
                        {h.content && (
                          <Text size="sm" mt={6}>
                            <b>Что заходит:</b> {h.content}
                          </Text>
                        )}
                        {h.topics.length > 0 && (
                          <Group gap={6} mt={6} wrap="wrap">
                            {h.topics.map((t, j) => (
                              <Badge key={j} size="sm" variant="light" color="gray" radius="sm">
                                {t}
                              </Badge>
                            ))}
                          </Group>
                        )}
                      </Box>
                    ))}
                  </Stack>
                ) : null}

                {/* ⚠️ Карточки шортсов тут больше НЕ дублируем: они живут на доске,
                    у них те же статусы и порядок (переключатель «Видео / Shorts»).
                    Раньше сетка показывала их вне статусов — поставил «в работе»,
                    и карточка не двигалась никуда, будто потерялась. */}
                {key === "shorts" && shorts.length > 0 ? (
                  <Text size="sm" c="dimmed">
                    Собрано шортсов: {shorts.length}. Они на доске — переключатель
                    «Shorts» над колонками.
                  </Text>
                ) : null}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        );
      })}
    </Accordion>
  );
}
