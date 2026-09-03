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
import BriefEditForm from "@/components/Settings/BriefEditForm";
import YouTubeConnect from "@/components/Settings/YouTubeConnect";
import TelegramConnect from "@/components/Settings/TelegramConnect";
import InstagramConnect from "@/components/Settings/InstagramConnect";
import { useProjectPlatform } from "@/hooks/useProjectPlatform";
import { apiGetProjectBrief, apiUpdateProjectBrief } from "@/lib/chat-client";
import { DISC_PROFILES, EMPTY_BRIEF, type Brief, type DiscProfile } from "@/lib/brief";

// Режим экрана: просмотр → анкета правки → визард с тестом личности (только по
// явной кнопке «пройти тест заново» из анкеты).
type Mode = "view" | "form" | "test";

// Настройки ПРОЕКТА (пер-проектные) — единый экран без вкладок: тип личности +
// «Исправить информацию» (перезапуск брифа проекта) + интеграция YouTube. Аккаунтные
// настройки (имя/почта/о себе/биллинг/язык) живут отдельно в модалке меню профиля.
export default function ProjectSettings({ projectId }: { projectId: string }) {
  const userId = useAppSelector((s) => s.auth.user?.id ?? "anon");
  const { platform } = useProjectPlatform();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  // На экране результата теста расширяем контейнер и прячем заголовок.
  const [editResult, setEditResult] = useState(false);
  const ytRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setMode("view");
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

  // Режим правки — АНКЕТА: все поля брифа разом и одна кнопка «Сохранить»
  // (правка владельца, 2026-09-03). Визард по одному вопросу остался для создания
  // проекта. На сохранение — PATCH брифа проекта; сервер сам ставит пересборку
  // профиля проекта (ensureProfileJob с force).
  if (mode === "form") {
    return (
      <Box maw={560} mx="auto">
        <Text fw={600} fz={{ base: "1.1rem", sm: "1.25rem" }} mb={4}>
          Исправить информацию
        </Text>
        <Text c="dimmed" size="sm" mb="lg">
          Поправь то, что изменилось, и сохрани — я пересоберу профиль проекта по новым
          данным.
        </Text>
        <BriefEditForm
          initial={brief ?? EMPTY_BRIEF}
          onSave={async (b) => {
            const res = await apiUpdateProjectBrief(projectId, b);
            if (res.ok) setBrief(b);
            return res;
          }}
          onCancel={() => setMode("view")}
          onRetakeTest={() => setMode("test")}
        />
      </Box>
    );
  }

  // Пройти тест типа личности заново — визард (как при создании проекта),
  // предзаполненный текущими данными; сюда попадают только из анкеты по кнопке.
  if (mode === "test") {
    return (
      <Box maw={editResult ? 900 : 560} mx="auto">
        {/* Заголовок прячем на экране результата — там полноэкранный reveal. */}
        {!editResult && (
          <>
            <Text fw={600} fz={{ base: "1.1rem", sm: "1.25rem" }} mb={4}>
              Пройти тест заново
            </Text>
            <Text c="dimmed" size="sm" mb="lg">
              Пара вопросов о проекте и короткий тест типа личности — на их основе я собираю
              контент именно под тебя.
            </Text>
          </>
        )}
        <BriefFlow
          initialBrief={brief}
          draftKey={`creative-chat:project-brief-edit-v1:${projectId}`}
          draftScope={userId}
          onResultChange={(disc) => setEditResult(disc !== null)}
          onSubmit={async (b) => {
            const res = await apiUpdateProjectBrief(projectId, b);
            if (res.ok) setBrief(b);
            return res;
          }}
          resultNote={
            <Text size="sm" c="dimmed">
              Готово — информация проекта обновлена, профиль пересобирается в фоне.
            </Text>
          }
          resultActions={() => (
            <Button color="brand" radius="md" onClick={() => setMode("view")}>
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
            onClick={() => setMode("form")}
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

      {/* Интеграции: YouTube — пер-проектный, телеграм — на аккаунт (бот пишет
          человеку в личку, второго телеграма у него нет). */}
      {/* ⚠️ Интеграция — по площадке проекта: у YouTube-проекта нет смысла в
          Instagram и наоборот. Обе сразу показывать нельзя — человек подключит
          не ту и не поймёт, почему в аналитике пусто. */}
      <Box ref={ytRef} style={{ scrollMarginTop: 12 }}>
        {platform === "instagram" ? (
          <InstagramConnect projectId={projectId} />
        ) : (
          <YouTubeConnect projectId={projectId} />
        )}
      </Box>

      <TelegramConnect />
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
