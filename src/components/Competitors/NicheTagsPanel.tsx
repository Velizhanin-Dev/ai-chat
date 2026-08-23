"use client";

import { useState } from "react";
import { Badge, Button, CopyButton, Group, Popover, Stack, Text } from "@mantine/core";
import { IconCheck, IconCopy, IconTags } from "@tabler/icons-react";
import { apiNicheTags } from "@/lib/keywords-client";
import type { CompetitorVideo } from "@/lib/competitors";

// Банк тегов ниши: чем размечают ролики те, у кого уже сработало.
//
// ⚠️ Считаем по ЧИСЛУ роликов, где тег встретился, а не по просмотрам: один
// залетевший ролик иначе протащит наверх свои случайные теги. И берём верхние
// ролики ВЫДАЧИ (то есть уже отфильтрованные по кратности) — то, что выстрелило,
// а не всё подряд.
//
// ⚠️ Квоту YouTube это не тратит вовсе (теги идут мимо Data API), но за каждым
// роликом — отдельная страница, поэтому разбираем верхние восемь, а не всю ленту.
const SCAN_LIMIT = 8;

export default function NicheTagsPanel({ videos }: { videos: CompetitorVideo[] }) {
  const [bank, setBank] = useState<{ tag: string; count: number }[] | null>(null);
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (loading) return;
    setLoading(true);
    const res = await apiNicheTags(videos.slice(0, SCAN_LIMIT).map((v) => v.id));
    setBank(res.bank);
    setScanned(res.scanned);
    setLoading(false);
  };

  return (
    <Popover width={420} position="bottom-start" withArrow shadow="md" trapFocus>
      <Popover.Target>
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<IconTags size={15} />}
          loading={loading}
          onClick={() => void load()}
        >
          Теги ниши
        </Button>
      </Popover.Target>

      <Popover.Dropdown>
        {bank === null ? (
          <Text size="sm" c="dimmed">
            Собираю теги у верхних роликов выдачи…
          </Text>
        ) : bank.length === 0 ? (
          <Text size="sm" c="dimmed">
            Теги не достались: авторы их не заполнили или YouTube сейчас не отдал.
          </Text>
        ) : (
          <Stack gap="xs">
            <Group justify="space-between" gap="xs">
              <Text size="xs" fw={600}>
                Чем размечают в этой нише
              </Text>
              <CopyButton value={bank.map((b) => b.tag).join(", ")} timeout={1500}>
                {({ copied, copy }) => (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    leftSection={copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                    onClick={copy}
                  >
                    {copied ? "Скопировано" : "Скопировать"}
                  </Button>
                )}
              </CopyButton>
            </Group>

            <Group gap={6}>
              {bank.map((b) => (
                <Badge
                  key={b.tag}
                  size="sm"
                  variant={b.count > 1 ? "filled" : "light"}
                  color={b.count > 1 ? "brand" : "gray"}
                  title={`Встречается у ${b.count} из ${scanned} разобранных роликов`}
                >
                  {b.tag}
                  {b.count > 1 ? ` ·${b.count}` : ""}
                </Badge>
              ))}
            </Group>

            {/* ⚠️ Сколько роликов реально отдали теги — обязательно: «30 тегов»
                без этой цифры читается как полный обзор ниши, хотя часть авторов
                теги просто не заполняет. */}
            <Text size="xs" c="dimmed">
              Разобрано роликов: {scanned}. Оранжевым — то, что повторяется у нескольких:
              это и есть слова, которыми тему ищут. Копировать список целиком не надо —
              теги должны описывать твой ролик.
            </Text>
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
