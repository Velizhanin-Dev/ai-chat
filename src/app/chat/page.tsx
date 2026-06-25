"use client";

import {
  Box,
  Title,
  Alert,
  Group,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { IconAlertCircle, IconTrash, IconCheck } from "@tabler/icons-react";
import ChatWindow from "@/components/Chat/ChatWindow";
import ChatInput from "@/components/Chat/ChatInput";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import {
  deleteConversation,
  setMessagesLoading,
  setConversationMessages,
} from "@/store/chatSlice";
import { authenticated } from "@/store/authSlice";
import { apiPaymentStatus } from "@/lib/auth-client";
import { apiGetMessages, apiDeleteConversation } from "@/lib/chat-client";
import { ymGoal } from "@/lib/metrika";

type PayNotice = { type: "success" | "pending" | "fail"; text: string };

export default function ChatPage() {
  const error = useAppSelector((s) => s.chat.error);
  const activeId = useAppSelector((s) => s.chat.activeId);
  // Загружены ли сообщения открытого диалога (метаданные приходят без них).
  const activeLoaded = useAppSelector(
    (s) => s.chat.conversations.find((c) => c.id === s.chat.activeId)?.messagesLoaded ?? true
  );
  const title = useAppSelector(
    (s) =>
      s.chat.conversations.find((c) => c.id === s.chat.activeId)?.title ?? "Новый чат"
  );
  const dispatch = useAppDispatch();

  // Возврат с платёжной страницы ТБанк (?payment=success&order=… / fail).
  // Синхронизируем платёж (GetState), обновляем тариф в сторе и чистим query.
  const [payNotice, setPayNotice] = useState<PayNotice | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const pay = sp.get("payment");
    const order = sp.get("order");
    if (!pay) return;
    if (pay === "success" && order) {
      setPayNotice({ type: "pending", text: "Проверяем оплату…" });
      void apiPaymentStatus(order).then((res) => {
        if (res.ok && res.data.status === "CONFIRMED") {
          if (res.data.user) dispatch(authenticated(res.data.user));
          ymGoal("payment_success", { order });
          setPayNotice({ type: "success", text: "Оплата прошла — тариф активирован." });
        } else {
          setPayNotice({
            type: "pending",
            text: "Оплата обрабатывается — тариф обновится после подтверждения банком.",
          });
        }
      });
    } else if (pay === "fail") {
      setPayNotice({ type: "fail", text: "Оплата не завершена. Попробуйте ещё раз." });
    }
    window.history.replaceState({}, "", "/chat");
  }, [dispatch]);

  // Ленивая подгрузка сообщений при открытии диалога из истории. Новосозданные
  // диалоги уже messagesLoaded=true, для них фетча не будет.
  useEffect(() => {
    if (!activeId || activeLoaded) return;
    const id = activeId;
    dispatch(setMessagesLoading(true));
    void apiGetMessages(id).then((res) => {
      if (res.ok) dispatch(setConversationMessages({ id, messages: res.data }));
      else dispatch(setMessagesLoading(false));
    });
  }, [activeId, activeLoaded, dispatch]);

  const handleDelete = () => {
    if (!activeId) return;
    dispatch(deleteConversation(activeId));
    void apiDeleteConversation(activeId);
  };

  return (
    <>
      <Group justify="space-between" mb={{ base: "xs", sm: "md" }} wrap="nowrap" style={{ flexShrink: 0 }}>
        <Title
          order={2}
          fz={{ base: "1.35rem", sm: "1.75rem" }}
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {title}
        </Title>
        {/* Движок модели теперь глобальный (выбирается в админке) — тумблера
            Claude/GLM у пользователя больше нет. */}
        {activeId && (
          <Tooltip label="Удалить чат">
            <ActionIcon
              variant="light"
              color="red"
              size="lg"
              onClick={handleDelete}
              style={{ flexShrink: 0 }}
            >
              <IconTrash size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>

      {payNotice && (
        <Alert
          icon={
            payNotice.type === "success" ? <IconCheck size={16} /> : <IconAlertCircle size={16} />
          }
          color={payNotice.type === "success" ? "teal" : payNotice.type === "fail" ? "red" : "brand"}
          mb="md"
          withCloseButton
          onClose={() => setPayNotice(null)}
        >
          {payNotice.text}
        </Alert>
      )}

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

      {/* Без карточки-обводки: сообщения «текут» по фону страницы, композер —
          отдельным мягким блоком снизу (см. ChatInput). Flex-колонка: окно
          сообщений тянется (flex:1) и скроллится само, ввод прижат снизу. */}
      <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <ChatWindow />
        <ChatInput />
      </Box>
    </>
  );
}
