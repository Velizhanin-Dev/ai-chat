"use client";

import { Title, Text, Stack } from "@mantine/core";
import GenerateForm from "@/components/Generate/GenerateForm";

export default function GeneratePage() {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Генерация сценария</Title>
        <Text c="dimmed" mt={4}>
          Напиши тему — получи готовый сценарий по методологии из базы знаний
        </Text>
      </div>

      <GenerateForm />
    </Stack>
  );
}
