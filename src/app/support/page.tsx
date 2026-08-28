"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconAlertCircle, IconHeadset } from "@tabler/icons-react";
import type { SupportMessageRow } from "@/lib/support";
import { apiSendSupportMessage, apiSupportMessages } from "@/lib/support-client";
import SupportChat from "@/components/Support/SupportChat";
import TelegramSupportButton from "@/components/Support/TelegramSupportButton";

// Чат техподдержки (/support) — отдельная страница внутри обвязки приложения
// (сайдбар + шапка), не пер-проектная: тред один на пользователя. Человек пишет
// — вопрос уходит в админку (/admin/support) и дублируется в телеграм-бот;
// ответ поддержки приходит сюда же.
//
// Пока страница открыта, раз в 20 секунд подтягиваем новые сообщения — чтобы
// ответ появлялся без перезагрузки. Гостя на эту страницу не пускает middleware.
const POLL_MS = 20_000;

export default function SupportPage() {
  const [messages, setMessages] = useState<SupportMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    try {
      // Гасим непрочитанные, только если вкладку реально смотрят: в свёрнутой
      // вкладке фоновый поллинг иначе «читал» ответ поддержки за человека.
      const visible =
        typeof document === "undefined" || document.visibilityState === "visible";
      const list = await apiSupportMessages(visible);
      setMessages(list);
    } catch (e) {
      // Фоновое обновление молчит: незачем показывать ошибку поверх переписки.
      if (initial) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить переписку");
      }
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const id = setInterval(() => void load(false), POLL_MS);
    // Вернулись на вкладку — сразу подтягиваем и дочитываем, не дожидаясь тика
    // (в скрытой вкладке непрочитанные намеренно не гасятся, см. load).
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const send = async (text: string, files: File[]) => {
    setSending(true);
    setError(null);
    // Оптимистично показываем своё сообщение — ждать сервер незачем.
    // ⚠️ Вложения в оптимистичной строке пустые: их адреса появятся только после
    // записи на сервер. Показывать локальные objectURL смысла нет — сообщение
    // через долю секунды заменится настоящим.
    const optimistic: SupportMessageRow = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      attachments: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const saved = await apiSendSupportMessage(text, files);
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? saved : m)));
    } catch (e) {
      // Не отправилось — убираем черновик из ленты, причину показываем алертом.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setError(e instanceof Error ? e.message : "Не удалось отправить сообщение");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Полоса раздела — в точности как меню проекта (TopNav): тянем «в край»
          через topnav-bleed, тот же кегль и высота. Своего TopNav у /support нет
          (он пер-проектный), поэтому полосу рисуем здесь. */}
      <Box
        className="topnav-bleed"
        mb={{ base: "xs", sm: "md" }}
        style={{
          flexShrink: 0,
          borderBottom: "1px solid var(--mantine-color-default-border)",
          background: "var(--mantine-color-body)",
        }}
      >
        <Group justify="space-between" wrap="nowrap" gap="sm" style={{ padding: "10px 16px" }}>
          <Text fw={600} fz="1rem" lh={1.2}>
            Поддержка VELIZHANIN&nbsp;AI
          </Text>
          {/* Тот же тред, только со стороны Telegram: человеку удобнее писать
              туда, а админ отвечает всё там же — в /admin/support. */}
          <TelegramSupportButton size="xs" />
        </Group>
      </Box>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          mb="sm"
          withCloseButton
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      <SupportChat
        messages={messages}
        me="user"
        loading={loading}
        sending={sending}
        onSend={send}
        placeholder="Опишите вопрос — ответим здесь же"
        emptyState={
          <Stack align="center" gap="xs" py={40} px="md">
            <ThemeIcon size={48} radius="xl" variant="light" color="brand">
              <IconHeadset size={26} />
            </ThemeIcon>
            <Text fw={600}>Задайте вопрос</Text>
            <Text size="sm" c="dimmed" ta="center" maw={380}>
              Напишите, что не работает или что непонятно. Ответим в этом же окне —
              загляните сюда позже, переписка сохранится.
            </Text>
          </Stack>
        }
      />
    </>
  );
}
