"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowRight,
  IconCheck,
  IconLock,
  IconMessageCircle,
  IconPhoto,
  IconRefresh,
  IconRoute,
  IconBrandYoutube,
} from "@tabler/icons-react";
import { useAppDispatch } from "@/store/hooks";
import { prefillInput } from "@/store/chatSlice";
import { apiRoadmap, apiRoadmapClaim, apiRoadmapRefresh } from "@/lib/roadmap-client";
import type { RoadmapStepView, RoadmapView } from "@/lib/roadmap";

// Дорожная карта канала (docs/channel-roadmap.md): шаги «что чинить», открываются
// по одному раз в 2 дня, проверяются переразбором. Живёт в разделе «Канал».

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

export default function RoadmapCard({ projectId }: { projectId: string }) {
  const [view, setView] = useState<RoadmapView | null>(null);
  const [connected, setConnected] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // key/"refresh" в работе

  const load = useCallback(async () => {
    const res = await apiRoadmap(projectId);
    if (res.ok) {
      if (res.data.connected) {
        setView(res.data.roadmap);
        setConnected(true);
      } else {
        setConnected(false);
      }
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setBusy("refresh");
    const res = await apiRoadmapRefresh(projectId);
    if (res.ok && res.data.connected) setView(res.data.roadmap);
    setBusy(null);
  };

  const claim = async (key: string) => {
    setBusy(key);
    const res = await apiRoadmapClaim(projectId, key);
    if (res.ok && res.data.connected) setView(res.data.roadmap);
    setBusy(null);
  };

  if (loading) {
    return (
      <Box className="an-surface" p="lg" style={{ display: "grid", placeItems: "center", minHeight: 160 }}>
        <Loader color="brand" size="sm" />
      </Box>
    );
  }

  // Внутри дашборда канал уже подключён, но на всякий случай — тихий фолбэк.
  if (!connected || !view) return null;

  return (
    <Box className="an-surface" p="lg">
      <Group justify="space-between" align="flex-start" mb="md" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ThemeIcon size={38} radius="md" variant="light" color="brand">
            <IconRoute size={20} />
          </ThemeIcon>
          <Box>
            <Text fw={700} fz="1.15rem" lh={1.15}>
              Дорожная карта
            </Text>
            <Text size="xs" c="dimmed">
              Что чинить по шагам — по одному раз в 2 дня
            </Text>
          </Box>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {view.totalCount > 0 && (
            <Badge variant="light" color="brand" radius="sm" size="lg">
              {view.doneCount} / {view.totalCount}
            </Badge>
          )}
          <Tooltip label="Проверить прогресс" withArrow>
            <ActionIcon
              variant="light"
              color="brand"
              radius="md"
              size="lg"
              onClick={refresh}
              loading={busy === "refresh"}
              aria-label="Проверить прогресс"
            >
              <IconRefresh size={17} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {view.allClear ? (
        <Box
          className="ach-spotlight"
          style={{ display: "flex", gap: 12, alignItems: "center" }}
        >
          <ThemeIcon size={40} radius="xl" variant="light" color="teal">
            <IconCheck size={22} />
          </ThemeIcon>
          <Box>
            <Text fw={700} c="teal">
              Канал в порядке
            </Text>
            <Text size="sm" c="dimmed">
              По цифрам чинить нечего. Выпускай новые ролики — проверю на следующем разборе.
            </Text>
          </Box>
        </Box>
      ) : (
        <Stack gap="sm">
          {view.steps.map((step, i) => (
            <StepRow
              key={step.key}
              step={step}
              index={i}
              busy={busy === step.key}
              projectId={projectId}
              onClaim={() => claim(step.key)}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}

function StepRow({
  step,
  index,
  busy,
  projectId,
  onClaim,
}: {
  step: RoadmapStepView;
  index: number;
  busy: boolean;
  projectId: string;
  onClaim: () => void;
}) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { status } = step;

  const goAction = () => {
    if (step.action === "chat") {
      if (step.chatPrompt) dispatch(prefillInput(step.chatPrompt));
      router.push(`/${projectId}/chat`);
    } else if (step.action === "thumbnails") {
      router.push(`/${projectId}/thumbnails`);
    } else if (step.action === "youtube") {
      window.open("https://studio.youtube.com", "_blank", "noopener");
    }
  };

  const actionIcon =
    step.action === "chat" ? (
      <IconMessageCircle size={16} />
    ) : step.action === "thumbnails" ? (
      <IconPhoto size={16} />
    ) : step.action === "youtube" ? (
      <IconBrandYoutube size={16} />
    ) : (
      <IconArrowRight size={16} />
    );

  return (
    <Box className={`rm-step is-${status}`}>
      <Marker index={index} status={status} />
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
          <Text fw={700} lh={1.2}>
            {step.title}
          </Text>
          {status === "done" && (
            <Badge color="teal" variant="light" radius="sm" leftSection={<IconCheck size={12} />}>
              Готово
            </Badge>
          )}
          {status === "claimed" && (
            <Badge color="brand" variant="light" radius="sm">
              На проверке
            </Badge>
          )}
          {status === "locked" && step.unlockAt && (
            <Badge color="gray" variant="light" radius="sm" leftSection={<IconLock size={12} />}>
              с {fmtDate(step.unlockAt)}
            </Badge>
          )}
        </Group>

        <Text size="sm" c="dimmed" mt={2}>
          {step.why}
        </Text>

        {status !== "locked" && status !== "done" && (
          <Text size="sm" mt={6}>
            {step.todo}
          </Text>
        )}

        {status === "open" && (
          <Group gap="xs" mt="sm" wrap="wrap">
            {step.action && (
              <Button
                size="xs"
                color="brand"
                variant="light"
                leftSection={actionIcon}
                onClick={goAction}
              >
                {step.actionLabel}
              </Button>
            )}
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              leftSection={<IconCheck size={15} />}
              onClick={onClaim}
              loading={busy}
            >
              Сделал
            </Button>
          </Group>
        )}

        {status === "claimed" && (
          <Text size="xs" c="dimmed" mt="sm">
            Отметил как сделанное. Подтвержу, когда выйдет новое видео или на следующем разборе
            канала — если ничего не изменится, галочка снимется.
          </Text>
        )}
      </Box>
    </Box>
  );
}

function Marker({ index, status }: { index: number; status: string }) {
  if (status === "done") {
    return (
      <Box
        className="rm-marker"
        style={{ background: "var(--mantine-color-teal-light)", color: "var(--mantine-color-teal-light-color)" }}
      >
        <IconCheck size={17} stroke={2.5} />
      </Box>
    );
  }
  if (status === "locked") {
    return (
      <Box
        className="rm-marker"
        style={{ background: "var(--mantine-color-gray-light)", color: "var(--mantine-color-gray-light-color)" }}
      >
        <IconLock size={15} />
      </Box>
    );
  }
  // open / claimed — акцентный номер.
  return (
    <Box
      className="rm-marker"
      style={{ background: "var(--mantine-color-brand-6)", color: "#fff" }}
    >
      {index + 1}
    </Box>
  );
}
