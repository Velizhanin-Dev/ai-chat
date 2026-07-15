"use client";

import Link from "next/link";
import { Button, Group, Paper, Text, ThemeIcon } from "@mantine/core";
import { IconBrandYoutube } from "@tabler/icons-react";

// Инлайновый призыв подключить YouTube-канал — рисуется под сообщением ассистента,
// когда модель поставила маркер (данные канала реально нужны), а канал не подключён.
// Ведёт в настройки проекта на вкладку интеграций (там сам OAuth-коннект).
export default function ConnectYouTubeCta({ projectId }: { projectId: string }) {
  return (
    <Paper
      withBorder
      radius="md"
      p="sm"
      mt="sm"
      style={{ background: "var(--mantine-color-brand-light)" }}
    >
      <Group gap="sm" wrap="nowrap" align="center">
        <ThemeIcon color="red" variant="light" radius="md" size={36} style={{ flexShrink: 0 }}>
          <IconBrandYoutube size={20} />
        </ThemeIcon>
        <Text size="sm" style={{ flex: 1, minWidth: 0 }}>
          Подключи канал — и я разберу твои ролики и рост по реальным цифрам.
        </Text>
        <Button
          component={Link}
          href={`/${projectId}/settings?tab=integrations`}
          color="brand"
          size="xs"
          radius="md"
          style={{ flexShrink: 0 }}
        >
          Подключить
        </Button>
      </Group>
    </Paper>
  );
}
