"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Alert,
  Badge,
  Box,
  Center,
  Grid,
  Group,
  Loader,
  Pagination,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconAlertCircle, IconHeadset, IconSearch } from "@tabler/icons-react";
import type { SupportMessageRow, SupportThreadRow } from "@/lib/support";
import {
  apiAdminSupportReply,
  apiAdminSupportThread,
  apiAdminSupportThreads,
} from "@/lib/support-client";
import { PlanBadge } from "@/components/Admin/Badges";
import SupportChat from "@/components/Support/SupportChat";

// Раздел «Поддержка» в админке: слева список переписок (свежие сверху, с
// бейджем непрочитанных вопросов), справа — сам чат. Открытие треда помечает
// вопросы прочитанными на сервере, поэтому счётчик гасим и локально.
//
// Ссылка из телеграм-уведомления приходит с ?user=<id> — сразу открываем тред.
const POLL_MS = 20_000;

export default function AdminSupportPage() {
  const searchParams = useSearchParams();
  const initialUser = searchParams.get("user");

  const [threads, setThreads] = useState<SupportThreadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(30);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ] = useDebouncedValue(q, 350);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeUser, setActiveUser] = useState<string | null>(initialUser);
  const [messages, setMessages] = useState<SupportMessageRow[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // ── Список переписок ──
  const loadThreads = useCallback(
    async (initial: boolean) => {
      if (initial) setListLoading(true);
      try {
        const data = await apiAdminSupportThreads({
          page,
          q: debouncedQ,
          onlyUnread: filter === "unread",
        });
        setThreads(data.threads);
        setTotal(data.total);
        setPageSize(data.pageSize);
      } catch (e) {
        if (initial) setError(e instanceof Error ? e.message : "Не удалось загрузить список");
      } finally {
        if (initial) setListLoading(false);
      }
    },
    [page, debouncedQ, filter]
  );

  useEffect(() => {
    void loadThreads(true);
    // Фоновое обновление списка — чтобы новые вопросы появлялись сами.
    const id = setInterval(() => void loadThreads(false), POLL_MS);
    return () => clearInterval(id);
  }, [loadThreads]);

  // Смена поиска/фильтра — всегда с первой страницы.
  useEffect(() => {
    setPage(1);
  }, [debouncedQ, filter]);

  // ── Открытый тред ──
  const loadThread = useCallback(async (userId: string, initial: boolean) => {
    if (initial) setThreadLoading(true);
    try {
      const data = await apiAdminSupportThread(userId);
      setMessages(data.messages);
    } catch (e) {
      if (initial) setError(e instanceof Error ? e.message : "Не удалось открыть переписку");
    } finally {
      if (initial) setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeUser) {
      setMessages([]);
      return;
    }
    void loadThread(activeUser, true);
    const id = setInterval(() => void loadThread(activeUser, false), POLL_MS);
    return () => clearInterval(id);
  }, [activeUser, loadThread]);

  const openThread = (userId: string) => {
    setActiveUser(userId);
    // Сервер пометит вопросы прочитанными — гасим бейдж сразу, не дожидаясь
    // следующего обновления списка.
    setThreads((prev) =>
      prev.map((t) => (t.userId === userId ? { ...t, unread: 0 } : t))
    );
  };

  const reply = async (text: string) => {
    if (!activeUser) return;
    setSending(true);
    setError(null);
    const optimistic: SupportMessageRow = {
      id: `tmp-${Date.now()}`,
      role: "admin",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const saved = await apiAdminSupportReply(activeUser, text);
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? saved : m)));
      void loadThreads(false); // подтянуть новый «последний ответ» в списке
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setError(e instanceof Error ? e.message : "Не удалось отправить ответ");
    } finally {
      setSending(false);
    }
  };

  const active = threads.find((t) => t.userId === activeUser) ?? null;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Поддержка</Title>
          <Text size="sm" c="dimmed">
            Вопросы пользователей из чата «Нужна помощь?». Ответ придёт им в тот же чат.
          </Text>
        </div>
      </Group>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          withCloseButton
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      <Grid gutter="md">
        {/* ── Список переписок ── */}
        <Grid.Col span={{ base: 12, md: 5, lg: 4 }}>
          <Stack gap="sm">
            <TextInput
              placeholder="Имя или почта"
              leftSection={<IconSearch size={16} />}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <SegmentedControl
              fullWidth
              value={filter}
              onChange={(v) => setFilter(v as "all" | "unread")}
              data={[
                { label: "Все", value: "all" },
                { label: "Непрочитанные", value: "unread" },
              ]}
            />

            {listLoading ? (
              <Center py={40}>
                <Loader color="brand" />
              </Center>
            ) : threads.length === 0 ? (
              <Paper withBorder p="lg" radius="md">
                <Text size="sm" c="dimmed" ta="center">
                  {filter === "unread"
                    ? "Непрочитанных вопросов нет"
                    : "Обращений пока нет"}
                </Text>
              </Paper>
            ) : (
              <Stack gap={4}>
                {threads.map((t) => {
                  const isActive = t.userId === activeUser;
                  return (
                    <UnstyledButton
                      key={t.userId}
                      onClick={() => openThread(t.userId)}
                      p="sm"
                      style={{
                        borderRadius: 10,
                        background: isActive
                          ? "var(--mantine-color-brand-light)"
                          : "transparent",
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap" gap="xs" mb={2}>
                        <Text size="sm" fw={600} truncate style={{ minWidth: 0 }}>
                          {t.name}
                        </Text>
                        {t.unread > 0 && (
                          <Badge size="sm" circle color="brand" style={{ flexShrink: 0 }}>
                            {t.unread}
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed" truncate>
                        {t.lastRole === "admin" ? "Вы: " : ""}
                        {t.lastMessage}
                      </Text>
                      <Group gap="xs" mt={4} wrap="nowrap">
                        <PlanBadge plan={t.plan} />
                        <Text size="xs" c="dimmed">
                          {new Date(t.lastAt).toLocaleString("ru-RU", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </Text>
                      </Group>
                    </UnstyledButton>
                  );
                })}
              </Stack>
            )}

            {pages > 1 && (
              <Pagination value={page} onChange={setPage} total={pages} size="sm" />
            )}
          </Stack>
        </Grid.Col>

        {/* ── Переписка ── */}
        <Grid.Col span={{ base: 12, md: 7, lg: 8 }}>
          <Paper
            withBorder
            radius="md"
            p="sm"
            // Высота — в globals.css (.admin-support-chat): на десктопе тянем
            // до низа экрана, на мобиле фиксируем (список стоит над чатом).
            className="admin-support-chat"
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            {!activeUser ? (
              <Center style={{ flex: 1 }}>
                <Stack align="center" gap="xs">
                  <IconHeadset size={32} style={{ color: "var(--mantine-color-dimmed)" }} />
                  {/* Без «слева»: на мобиле список стоит НАД перепиской, а не сбоку. */}
                  <Text size="sm" c="dimmed">
                    Выберите обращение
                  </Text>
                </Stack>
              </Center>
            ) : (
              <>
                <Box mb="xs" style={{ flexShrink: 0 }}>
                  <Text fw={600}>{active?.name ?? "Пользователь"}</Text>
                  <Text size="xs" c="dimmed">
                    {active?.email ?? ""}
                  </Text>
                </Box>
                <SupportChat
                  messages={messages}
                  me="admin"
                  loading={threadLoading}
                  sending={sending}
                  onSend={reply}
                  placeholder="Ответ пользователю..."
                />
              </>
            )}
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
