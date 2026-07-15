"use client";

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { IconSparkles, IconEdit, IconAlertCircle } from "@tabler/icons-react";
import { useAppSelector } from "@/store/hooks";
import BriefFlow from "@/components/Brief/BriefFlow";
import YouTubeConnect from "@/components/Settings/YouTubeConnect";
import { apiGetProjectBrief, apiUpdateProjectBrief } from "@/lib/chat-client";
import { DISC_PROFILES, type Brief, type DiscProfile } from "@/lib/brief";

// Настройки ПРОЕКТА (пер-проектные) — единый экран без вкладок: тип личности +
// «Исправить информацию» (перезапуск брифа проекта) + интеграция YouTube. Аккаунтные
// настройки (имя/почта/о себе/биллинг/язык) живут отдельно в модалке меню профиля.
export default function ProjectSettings({ projectId }: { projectId: string }) {
  const userId = useAppSelector((s) => s.auth.user?.id ?? "anon");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const ytRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setEditing(false);
    apiGetProjectBrief(projectId).then((r) => {
      if (!alive) return;
      if (r.ok) setBrief(r.data);
      else setError(r.error);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Приход по старой ссылке ?tab=integrations (CTA из чата/дашборда «Канал») —
  // проскроллим к секции YouTube, чтобы она сразу была видна под шапкой.
  useEffect(() => {
    if (loading || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("tab") === "integrations") {
      ytRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loading]);

  // Режим правки — визард брифа на месте (Typeform-style, как при создании проекта),
  // предзаполненный текущими данными. На сохранение — PATCH брифа проекта.
  if (editing) {
    return (
      <Box maw={560} mx="auto">
        <Text fw={600} fz={{ base: "1.1rem", sm: "1.25rem" }} mb={4}>
          Исправить информацию
        </Text>
        <Text c="dimmed" size="sm" mb="lg">
          Пара вопросов о проекте и короткий тест типа личности — на их основе я собираю
          контент именно под тебя.
        </Text>
        <BriefFlow
          initialBrief={brief}
          draftKey={`creative-chat:project-brief-edit-v1:${projectId}`}
          draftScope={userId}
          onSubmit={async (b) => {
            const res = await apiUpdateProjectBrief(projectId, b);
            if (res.ok) setBrief(b);
            return res;
          }}
          resultNote={
            <Text size="sm" c="dimmed">
              Готово — информация проекта обновлена.
            </Text>
          }
          resultActions={() => (
            <Button color="brand" radius="md" onClick={() => setEditing(false)}>
              Готово
            </Button>
          )}
        />
      </Box>
    );
  }

  const profile = brief?.disc ? DISC_PROFILES[brief.disc] : null;

  return (
    <Stack gap="lg">
      {/* Тип личности + кнопка правки */}
      <Box>
        <Group justify="space-between" mb="sm" wrap="nowrap" gap="sm">
          <Text fw={600}>Мой тип личности</Text>
          <Button
            variant="light"
            color="brand"
            size="xs"
            leftSection={<IconEdit size={14} />}
            onClick={() => setEditing(true)}
            disabled={loading}
            style={{ flexShrink: 0 }}
          >
            Исправить информацию
          </Button>
        </Group>

        {loading ? (
          <Skeleton height={150} radius="lg" />
        ) : error ? (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        ) : profile ? (
          <PersonalityCard profile={profile} />
        ) : (
          <Paper withBorder radius="lg" p="md">
            <Text size="sm" c="dimmed">
              Тип личности ещё не определён. Нажми «Исправить информацию» и пройди короткий
              тест — я подстрою контент под твой типаж.
            </Text>
          </Paper>
        )}
      </Box>

      <Divider />

      {/* Интеграция YouTube */}
      <Box ref={ytRef} style={{ scrollMarginTop: 12 }}>
        <YouTubeConnect projectId={projectId} />
      </Box>
    </Stack>
  );
}

function PersonalityCard({ profile }: { profile: DiscProfile }) {
  return (
    <Paper withBorder radius="lg" p="md">
      <Group gap="sm" mb="md" wrap="nowrap" align="flex-start">
        <ThemeIcon color="brand" variant="light" radius="md" size={44} style={{ flexShrink: 0 }}>
          <IconSparkles size={24} />
        </ThemeIcon>
        <Box style={{ minWidth: 0 }}>
          <Group gap={8} wrap="nowrap">
            <Text fw={700} fz="lg" lineClamp={1}>
              «{profile.nick}»
            </Text>
            <Badge color="brand" variant="light" radius="sm" style={{ flexShrink: 0 }}>
              {profile.code}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            {profile.character}
          </Text>
        </Box>
      </Group>
      <Stack gap="sm">
        <Trait label="Подходящие форматы" value={profile.formats} />
        <Trait label="Что заводит" value={profile.works} />
        <Trait label="Что убивает" value={profile.kills} />
      </Stack>
    </Paper>
  );
}

function Trait({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text size="xs" c="dimmed" fw={600} tt="uppercase" lts={0.3}>
        {label}
      </Text>
      <Text size="sm">{value}</Text>
    </Box>
  );
}
