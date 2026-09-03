"use client";

import { useState } from "react";
import { ActionIcon, Button, CopyButton, Group, Popover, Stack, Text, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy, IconTags } from "@tabler/icons-react";
import { apiVideoTags } from "@/lib/keywords-client";

// Теги чужого ролика прямо на его карточке.
//
// ⚠️ В Data API их нет: с 2021 `videos.list` отдаёт теги только владельцу канала —
// именно поэтому в CLAUDE.md долго стояло «тегов у чужого ролика не будет». На
// странице ролика они лежат открыто, и это ровно та фича, за которую платят vidIQ и
// TubeBuddy. Стоит 0 units квоты.
//
// ⚠️ Тянем ПО КЛИКУ, а не вместе с выдачей: за каждым роликом отдельная страница,
// и грузить их пачкой ради значка на карточке — прожечь трафик впустую.
export default function VideoTagsButton({
  videoId,
  /** Отступ сверху: кнопок в стопке над превью может быть две или три. */
  top = 96,
}: {
  videoId: string;
  top?: number;
}) {
  const [tags, setTags] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);

  const load = async () => {
    if (tags || loading) return;
    setLoading(true);
    setTags(await apiVideoTags(videoId));
    setLoading(false);
  };

  // ⚠️⚠️ Поповер КОНТРОЛИРУЕМЫЙ (opened/onChange) не ради красоты. В неуправляемом
  // режиме Popover.Target подсовывает ребёнку свой onClick (переключение), а ребёнок
  // тут — Tooltip, который клонирует иконку как `{ onClick, …, ...childProps }`:
  // собственный onClick иконки (загрузка тегов) ЗАТИРАЛ переключение поповера.
  // Итог на проде: клик грузил теги, а окно не открывалось никогда — «кнопка не
  // работает». В управляемом режиме Popover.Target onClick не подсовывает, и наш
  // обработчик делает оба дела сам.
  return (
    <Popover
      width={320}
      position="bottom-end"
      withArrow
      shadow="md"
      trapFocus
      opened={opened}
      onChange={setOpened}
    >
      <Popover.Target>
        <Tooltip label="Теги ролика" withArrow>
          <ActionIcon
            variant="filled"
            color="dark"
            radius="md"
            size="lg"
            aria-label="Показать теги ролика"
            aria-expanded={opened}
            loading={loading}
            onClick={() => {
              setOpened((v) => !v);
              void load();
            }}
            style={{ position: "absolute", right: 8, top, zIndex: 2 }}
          >
            <IconTags size={18} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown>
        {tags === null ? (
          <Text size="sm" c="dimmed">
            Загружаю теги…
          </Text>
        ) : tags.length === 0 ? (
          // ⚠️ Пустой список — штатно: автор мог не заполнить теги, а путь к ним
          // неофициальный и может отвалиться. Это не ошибка карточки.
          <Text size="sm" c="dimmed">
            Теги не достались — либо автор их не заполнил, либо YouTube их сейчас не отдал.
          </Text>
        ) : (
          <Stack gap="xs">
            <Group justify="space-between" gap="xs">
              <Text size="xs" fw={600}>
                Теги ролика ({tags.length})
              </Text>
              <CopyButton value={tags.join(", ")} timeout={1500}>
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
            <Text size="xs" style={{ lineHeight: 1.6 }}>
              {tags.join(" · ")}
            </Text>
            <Text size="xs" c="dimmed">
              Это лексика ниши словами конкурента. Копировать список целиком смысла нет — бери
              оттуда слова, которыми твою тему реально ищут.
            </Text>
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
