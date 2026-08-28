"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Box, Group, Loader, Popover, Text, UnstyledButton } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { useAppSelector } from "@/store/hooks";
import { apiActiveJobs } from "@/lib/jobs-client";
import { JOB_LABELS, type JobKind, type JobView } from "@/lib/jobs";

// «Задачи в процессе» — что считается в фоне прямо сейчас.
//
// ⚠️ Зачем: фоновые задачи задумывались как «можно уйти со страницы, результат не
// потеряется», но узнать, что происходит, можно было ТОЛЬКО со страницы, где
// задачу запустили. Человек уходил в чат и не знал, собирается ли ещё его
// контент-план и не отвалилась ли генерация превью.
//
// ⚠️⚠️ Наружу торчит ТОЛЬКО крутилка — ни подписи, ни счётчика. Панель с текстом
// «Задачи в процессе» шириной 240px закрывала на телефоне две трети экрана, а в
// правом нижнем углу чата стоит кнопка отправки: якорь перекрывал бы её, и
// написать сообщение стало бы нельзя. Крутилка занимает 32px и ничего не
// загораживает; подробности — по нажатию.
//
// ⚠️ Ничего НЕ показываем, когда работы нет: постоянная плашка в углу — шум.
// Кнопки «закрыть» тоже нет намеренно — её закрывают не глядя, а потом не
// находят результат.

const POLL_MS = 6000;
/** Сколько держим завершённую задачу на экране, чтобы человек успел её заметить. */
const DONE_LINGER_MS = 20_000;

/** Куда вести по клику: у каждой задачи есть «свой» раздел с результатом. */
function hrefFor(kind: JobKind, projectId: string | null): string | null {
  if (!projectId) return null;
  switch (kind) {
    case "thumbnail_generate":
      return `/${projectId}/thumbnails`;
    case "content_plan_generate":
    case "content_plan_block":
      return `/${projectId}/content-plan`;
    case "channel_diagnose":
    case "video_analyze":
      return `/${projectId}/channel`;
    // Профиль проекта человек не заказывал и открывать ему нечего: он просто
    // делает следующие ответы точнее.
    case "project_profile":
      return null;
  }
}

export interface JobRow {
  id: string;
  kind: JobKind;
  projectId: string | null;
  /** running/queued — идёт; done — только что закончилась. */
  state: "active" | "done";
}

/**
 * Опрос активных задач.
 *
 * Хук отдаёт и идущие задачи, и только что завершённые (их держим на экране
 * недолго, чтобы человек успел заметить и перейти к результату).
 */
export function useActiveJobs(): JobRow[] {
  const user = useAppSelector((s) => s.auth.user);
  const [rows, setRows] = useState<JobRow[]>([]);
  // Что видели активным в прошлый раз: по разнице и понимаем, что задача
  // завершилась. Сервер отдаёт ТОЛЬКО незавершённые (listActiveJobs), поэтому
  // «готово» иначе неоткуда взять.
  const known = useRef<Map<string, JobRow>>(new Map());

  const tick = useCallback(async () => {
    const jobs: JobView[] = await apiActiveJobs({});
    const next = new Map<string, JobRow>(
      jobs.map((j) => [
        j.id,
        { id: j.id, kind: j.kind, projectId: j.conversationId, state: "active" as const },
      ])
    );

    // ⚠️ Array.from, а не прямая итерация Map: текущий target сборки её не
    // принимает (та же семья, что запрет на итерацию Set в content-plan.ts).
    for (const [id, prev] of Array.from(known.current.entries())) {
      if (next.has(id)) continue;
      if (prev.state === "active") {
        // Пропала из активных — значит доработала. Держим ещё немного и убираем.
        next.set(id, { ...prev, state: "done" });
        setTimeout(() => {
          known.current.delete(id);
          setRows((cur) => cur.filter((r) => r.id !== id));
        }, DONE_LINGER_MS);
      } else {
        // Уже помечена готовой — держим до истечения таймера выше.
        next.set(id, prev);
      }
    }

    known.current = next;
    setRows(Array.from(next.values()));
  }, []);

  useEffect(() => {
    if (!user) {
      setRows([]);
      known.current = new Map();
      return;
    }
    void tick();
    const id = setInterval(() => {
      // В скрытой вкладке не опрашиваем: задачи никуда не денутся, а лишние
      // запросы каждые шесть секунд с десятка открытых вкладок нам не нужны.
      if (document.visibilityState === "visible") void tick();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [user, tick]);

  return rows;
}

/**
 * Крутилка в правом нижнем углу. Всё содержимое — в поповере по нажатию.
 */
export default function JobsAnchor() {
  const rows = useActiveJobs();
  const [open, setOpen] = useState(false);
  const conversations = useAppSelector((s) => s.chat.conversations);

  if (rows.length === 0) return null;

  const activeCount = rows.filter((r) => r.state === "active").length;
  const projectTitle = (id: string | null) =>
    conversations.find((c) => c.id === id)?.title ?? "";

  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position="top-end"
      width={260}
      shadow="md"
      radius="md"
      withArrow
    >
      <Popover.Target>
        <UnstyledButton
          className="jobs-anchor"
          onClick={() => setOpen((v) => !v)}
          aria-label={
            activeCount > 0 ? `Задач в процессе: ${activeCount}` : "Задачи завершены"
          }
          title={activeCount > 0 ? "Задачи в процессе" : "Готово"}
        >
          {activeCount > 0 ? (
            <Loader size={18} color="brand" />
          ) : (
            <IconCheck size={18} color="var(--mantine-color-teal-6)" />
          )}
        </UnstyledButton>
      </Popover.Target>

      <Popover.Dropdown p="sm">
        {rows.map((r) => {
          const meta = JOB_LABELS[r.kind];
          const href = r.state === "done" ? hrefFor(r.kind, r.projectId) : null;
          const title = projectTitle(r.projectId);
          const body = (
            <Group gap="xs" wrap="nowrap" align="flex-start" py={6}>
              <Box mt={3} style={{ flexShrink: 0 }}>
                {r.state === "active" ? (
                  <Loader size={14} color="brand" />
                ) : (
                  <IconCheck size={14} color="var(--mantine-color-teal-6)" />
                )}
              </Box>
              <Box style={{ minWidth: 0 }}>
                <Text size="sm" lineClamp={1}>
                  {r.state === "done" ? `${meta.title} — готово` : meta.title}
                </Text>
                {title && (
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {title}
                  </Text>
                )}
              </Box>
            </Group>
          );
          // ⚠️ Ссылкой делаем только ЗАВЕРШЁННУЮ задачу: пока она считается,
          // открывать нечего, а кликабельная строка обещает результат.
          return href ? (
            <UnstyledButton
              key={r.id}
              component={Link}
              href={href}
              display="block"
              w="100%"
              onClick={() => setOpen(false)}
            >
              {body}
            </UnstyledButton>
          ) : (
            <Box key={r.id}>{body}</Box>
          );
        })}
        <Text size="xs" c="dimmed" mt={4}>
          Можно уйти со страницы — работа не прервётся.
        </Text>
      </Popover.Dropdown>
    </Popover>
  );
}
