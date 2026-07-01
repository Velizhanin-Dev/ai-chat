"use client";

import { Box, Title } from "@mantine/core";
import SettingsContent from "@/components/Settings/SettingsContent";

// Настройки в контексте проекта (/{projectId}/settings) — вкладка горизонтального
// меню. Содержимое аккаунтное (общее с модалкой настроек, SettingsContent).
// Доступ — авторизация (middleware); отдельного админ-гварда нет.
export default function ProjectSettingsPage() {
  return (
    <Box style={{ flex: 1, minHeight: 0, overflowY: "auto" }} py="md">
      <Box maw={760} mx="auto" px={{ base: 4, sm: 0 }}>
        <Title order={2} fz={{ base: "1.35rem", sm: "1.75rem" }} mb="md">
          Настройки
        </Title>
        <SettingsContent initialTab="general" />
      </Box>
    </Box>
  );
}
