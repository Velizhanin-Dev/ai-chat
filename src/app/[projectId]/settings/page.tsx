"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Box, Title } from "@mantine/core";
import SettingsContent from "@/components/Settings/SettingsContent";

// Настройки в контексте проекта (/{projectId}/settings) — вкладка горизонтального
// меню. Содержимое аккаунтное (общее с модалкой настроек, SettingsContent).
// Доступ — авторизация (middleware); отдельного админ-гварда нет.
// ?tab= позволяет открыть нужную вкладку (напр. дашборд «Канал» ведёт сюда на
// "integrations"). useSearchParams требует Suspense-обёртки при сборке.
function ProjectSettingsInner() {
  const tab = useSearchParams().get("tab") || "general";
  const params = useParams();
  const projectId = typeof params.projectId === "string" ? params.projectId : undefined;
  return (
    <Box style={{ flex: 1, minHeight: 0, overflowY: "auto" }} py="md">
      <Box maw={760} mx="auto" px={{ base: 4, sm: 0 }}>
        <Title order={2} fz={{ base: "1.35rem", sm: "1.75rem" }} mb="md">
          Настройки
        </Title>
        <SettingsContent initialTab={tab} projectId={projectId} />
      </Box>
    </Box>
  );
}

export default function ProjectSettingsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectSettingsInner />
    </Suspense>
  );
}
