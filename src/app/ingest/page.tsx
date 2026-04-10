"use client";

import { Title, Text, Stack } from "@mantine/core";
import IngestForm from "@/components/Ingest/IngestForm";
import DocumentList from "@/components/Ingest/DocumentList";

export default function IngestPage() {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Загрузка документов</Title>
        <Text c="dimmed" mt={4}>
          Загрузите текст или файлы для индексации в RAG-систему
        </Text>
      </div>

      <IngestForm />
      <DocumentList />
    </Stack>
  );
}
