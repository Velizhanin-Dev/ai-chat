"use client";

import { useParams } from "next/navigation";
import { Box, Title } from "@mantine/core";
import ProjectSettings from "@/components/Settings/ProjectSettings";

// Настройки ПРОЕКТА (/{projectId}/settings) — вкладка горизонтального меню. Единый
// экран: тип личности + «Исправить информацию» (перезапуск брифа) + интеграция
// YouTube. Аккаунтные настройки (имя/почта/о себе/биллинг/язык) — в модалке меню
// профиля (SettingsModal). Доступ — авторизация (middleware).
export default function ProjectSettingsPage() {
  const params = useParams();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  return (
    <Box style={{ flex: 1, minHeight: 0, overflowY: "auto" }} py="md">
      <Box maw={760} mx="auto" px={{ base: 4, sm: 0 }}>
        <Title order={2} fz={{ base: "1.35rem", sm: "1.75rem" }} mb="md">
          Настройки проекта
        </Title>
        {projectId && <ProjectSettings projectId={projectId} />}
      </Box>
    </Box>
  );
}
