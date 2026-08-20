"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Group,
  Loader,
  Modal,
  Select,
  Button,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconAlertTriangle, IconBulb, IconCheck, IconLink } from "@tabler/icons-react";
import {
  apiAddVideo,
  apiContentPlan,
  apiContentPlans,
  apiUpdateVideo,
} from "@/lib/content-plan-client";
import {
  STATUS_META,
  primaryTitle,
  type ContentPlanMeta,
  type VideoView,
} from "@/lib/content-plan";
import { formatRatio, type CompetitorVideo } from "@/lib/competitors";

// Положить найденный ролик конкурента референсом в конкретную карточку
// контент-плана. Смысл связки: в разделе «Референсы» видно, ЧТО выстрелило в нише,
// а референс — это поле карточки, по которому потом снимают свой ролик.
//
// ⚠️ Референс — ОДНА строка (см. VideoDrawer, TextInput «Референс (видео-донор)»),
// поэтому не дописываем к старому, а заменяем; если он уже занят, показываем текущий
// прямо в списке, чтобы замена не была сюрпризом.

export function referenceLine(v: CompetitorVideo): string {
  return `${v.title} (${formatRatio(v.ratio)}) — https://youtu.be/${v.id}`;
}

export default function AddReferenceModal({
  projectId,
  video,
  onClose,
}: {
  projectId: string;
  video: CompetitorVideo | null;
  onClose: () => void;
}) {
  const [plans, setPlans] = useState<ContentPlanMeta[] | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoView[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Список планов проекта — при каждом открытии (планы могли добавиться).
  useEffect(() => {
    if (!video) return;
    setError(null);
    setSavedId(null);
    setCreatedId(null);
    apiContentPlans(projectId).then((res) => {
      if (!res.ok) {
        setError(res.error);
        setPlans([]);
        return;
      }
      setPlans(res.data.plans);
      setPlanId((cur) => cur ?? res.data.plans[0]?.id ?? null);
    });
  }, [video, projectId]);

  // Карточки выбранного плана.
  useEffect(() => {
    if (!video || !planId) return;
    let alive = true;
    setVideos(null);
    apiContentPlan(planId).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setError(res.error);
        setVideos([]);
        return;
      }
      setVideos(res.data.plan.videos);
    });
    return () => {
      alive = false;
    };
  }, [video, planId]);

  const attach = async (target: VideoView) => {
    if (!video) return;
    setSaving(target.id);
    setError(null);
    const res = await apiUpdateVideo(target.id, { reference: referenceLine(video) });
    setSaving(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSavedId(target.id);
    // Локально отражаем новый референс — список остаётся открытым, можно
    // положить тот же ролик ещё в одну карточку.
    setVideos((cur) =>
      cur ? cur.map((v) => (v.id === target.id ? { ...v, reference: referenceLine(video) } : v)) : cur
    );
  };

  /**
   * Завести НОВУЮ карточку-идею по залетевшему ролику конкурента.
   *
   * ⚠️ Название конкурента кладётся как ЗАГОТОВКА, а не как готовое: копировать
   * чужое название методика прямо запрещает («средняя по интернету идея»), поэтому
   * карточка помечается source:"competitor", ссылка на донора идёт в reference, а
   * переписать под себя можно кнопкой «Переделать названия» в самой карточке.
   */
  const createIdea = async () => {
    if (!video || !planId) return;
    setCreating(true);
    setError(null);
    const res = await apiAddVideo(planId, {
      title: video.title,
      reference: referenceLine(video),
    });
    setCreating(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setCreatedId(res.data.video.id);
    setVideos((cur) => (cur ? [...cur, res.data.video] : cur));
  };

  return (
    <Modal
      opened={video != null}
      onClose={onClose}
      title="Добавить референсом в контент-план"
      size="lg"
      radius="md"
    >
      {video && (
        <Stack gap="md">
          <Box>
            <Text size="sm" fw={600} lineClamp={2}>
              {video.title}
            </Text>
            <Text size="xs" c="dimmed">
              {video.channelTitle} · {formatRatio(video.ratio)} к подписчикам
            </Text>
          </Box>

          {error && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
              {error}
            </Alert>
          )}

          {plans && plans.length === 0 && !error && (
            <Alert color="gray" variant="light">
              В этом проекте ещё нет контент-плана. Соберите его в разделе «Контент-план» —
              тогда сюда можно будет складывать референсы.
            </Alert>
          )}

          {plans && plans.length > 0 && (
            <Select
              label="План"
              data={plans.map((p) => ({ value: p.id, label: p.label }))}
              value={planId}
              onChange={setPlanId}
              allowDeselect={false}
              size="sm"
            />
          )}

          {plans && plans.length > 0 && videos === null && (
            <Group justify="center" py="md">
              <Loader size="sm" />
            </Group>
          )}

          {plans && plans.length > 0 && (
            <Button
              variant="light"
              color="brand"
              leftSection={<IconBulb size={16} />}
              onClick={() => void createIdea()}
              loading={creating}
              disabled={createdId != null}
            >
              {createdId
                ? "Идея заведена — переписать название можно в контент-плане"
                : "Завести новую карточку-идею"}
            </Button>
          )}

          {videos && videos.length > 0 && (
            <Stack gap={6}>
              <Text size="xs" c="dimmed">
                …или выберите готовую карточку — референс запишется в неё
              </Text>
              {videos.map((v) => {
                const meta = STATUS_META[v.status];
                const done = savedId === v.id;
                return (
                  <UnstyledButton
                    key={v.id}
                    onClick={() => attach(v)}
                    disabled={saving != null}
                    p="xs"
                    style={{
                      borderRadius: 10,
                      background: done
                        ? "var(--mantine-color-teal-light)"
                        : "var(--mantine-color-default)",
                      opacity: saving && saving !== v.id ? 0.6 : 1,
                    }}
                  >
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                      <Badge size="sm" color={meta.color} variant="light" style={{ flexShrink: 0 }}>
                        {meta.label}
                      </Badge>
                      <Box style={{ minWidth: 0, flex: 1 }}>
                        <Text size="sm" lineClamp={1}>
                          {primaryTitle(v)}
                        </Text>
                        {/* Текущий референс показываем всегда: карточка может быть уже
                            занята, и замена не должна быть неожиданностью. */}
                        {v.reference && (
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {done ? "новый референс: " : "сейчас: "}
                            {v.reference}
                          </Text>
                        )}
                      </Box>
                      {saving === v.id ? (
                        <Loader size={16} />
                      ) : done ? (
                        <IconCheck size={16} style={{ color: "var(--mantine-color-teal-6)" }} />
                      ) : (
                        <IconLink size={16} style={{ color: "var(--mantine-color-dimmed)" }} />
                      )}
                    </Group>
                  </UnstyledButton>
                );
              })}
            </Stack>
          )}

          {videos && videos.length === 0 && plans && plans.length > 0 && (
            <Text size="sm" c="dimmed">
              В этом плане пока нет карточек.
            </Text>
          )}
        </Stack>
      )}
    </Modal>
  );
}
