"use client";

import { Paper, Text, Stack, Group, Badge, ThemeIcon } from "@mantine/core";
import { IconFileText } from "@tabler/icons-react";
import { useAppSelector } from "@/store/hooks";

export default function DocumentList() {
  const documents = useAppSelector((s) => s.ingest.documents);

  if (documents.length === 0) return null;

  return (
    <Paper shadow="xs" p="lg" radius="md" withBorder>
      <Text fw={600} size="lg" mb="md">
        Загруженные документы
      </Text>
      <Stack gap="sm">
        {documents.map((doc) => (
          <Paper key={doc.id} p="sm" radius="sm" bg="gray.0">
            <Group justify="space-between">
              <Group gap="sm">
                <ThemeIcon variant="light" color="blue" size="md">
                  <IconFileText size={16} />
                </ThemeIcon>
                <div>
                  <Text size="sm" fw={500}>
                    {doc.source}
                    {doc.speaker && (
                      <Text span c="dimmed" size="sm"> — {doc.speaker}</Text>
                    )}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {new Date(doc.createdAt).toLocaleString("ru-RU")}
                  </Text>
                </div>
              </Group>
              <Badge variant="light" color="teal">
                {doc.chunksCount} чанков
              </Badge>
            </Group>
          </Paper>
        ))}
      </Stack>
    </Paper>
  );
}
