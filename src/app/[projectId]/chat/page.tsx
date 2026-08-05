"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Box, Alert, Center, Loader } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import ChatWindow from "@/components/Chat/ChatWindow";
import ChatInput from "@/components/Chat/ChatInput";
import SubscriptionModal from "@/components/Billing/SubscriptionModal";
import { useChatAccess } from "@/hooks/useChatAccess";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setMessagesLoading, setConversationMessages } from "@/store/chatSlice";
import { apiGetMessages } from "@/lib/chat-client";

// Чат конкретного проекта (/{projectId}/chat). projectId — из URL; activeId стора
// синхронит ProjectLayout. Бриф/создание проекта живёт на /app (не здесь).
export default function ProjectChatPage() {
  const params = useParams();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  const dispatch = useAppDispatch();

  const error = useAppSelector((s) => s.chat.error);
  const activeId = useAppSelector((s) => s.chat.activeId);
  const conversations = useAppSelector((s) => s.chat.conversations);
  const hydrated = useAppSelector((s) => s.chat.hydrated);
  const activeConv = conversations.find((c) => c.id === projectId) ?? null;
  const activeLoaded = activeConv?.messagesLoaded ?? false;
  // activeId синхронизируется с URL в ProjectLayout (после гидратации). Пока не
  // совпало — рендерим лоадер, чтобы ChatWindow/ChatInput (читают activeId) не
  // мигнули предыдущим проектом.
  const synced = activeId === projectId;

  // Доступ к чату: тариф истёк / кончились запросы → блокировка + модалка тарифов.
  const access = useChatAccess();
  const [subModalOpen, setSubModalOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (access.ready && access.locked && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setSubModalOpen(true);
    }
    if (!access.locked) autoOpenedRef.current = false;
  }, [access.ready, access.locked]);

  // Ленивая подгрузка сообщений при открытии проекта.
  useEffect(() => {
    if (!activeConv || activeLoaded) return;
    const id = projectId;
    dispatch(setMessagesLoading(true));
    void apiGetMessages(id).then((res) => {
      if (res.ok) dispatch(setConversationMessages({ id, messages: res.data }));
      else dispatch(setMessagesLoading(false));
    });
  }, [projectId, activeConv, activeLoaded, dispatch]);

  // Название проекта и действия над ним (переименовать/удалить) живут в ШАПКЕ
  // приложения (components/Shell/ProjectHeaderTitle) — отдельной строки-заголовка
  // здесь больше нет, она дублировала название и съедала высоту на телефоне.

  // Проект ещё не подтверждён/не синхронизирован (идёт гидратация). Чужой/удалённый
  // ProjectLayout уведёт на /app; здесь — просто лоадер до синхронизации.
  if (!hydrated || !activeConv || !synced) {
    return (
      <Center style={{ flex: 1 }}>
        <Loader color="brand" />
      </Center>
    );
  }

  return (
    <>
      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="Ошибка"
          color="red"
          mb="md"
          withCloseButton
        >
          {error}
        </Alert>
      )}

      <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <ChatWindow />
        <ChatInput
          locked={access.locked}
          lockReason={access.reason}
          onUpgrade={() => setSubModalOpen(true)}
        />
      </Box>

      <SubscriptionModal
        opened={subModalOpen}
        onClose={() => setSubModalOpen(false)}
        reason={access.reason}
      />

    </>
  );
}
