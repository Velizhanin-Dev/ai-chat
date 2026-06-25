"use client";

import {
  Box,
  Title,
  Alert,
  Group,
  ActionIcon,
  Tooltip,
  SegmentedControl,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { IconAlertCircle, IconTrash, IconCheck } from "@tabler/icons-react";
import ChatWindow from "@/components/Chat/ChatWindow";
import ChatInput from "@/components/Chat/ChatInput";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { deleteConversation } from "@/store/chatSlice";
import { setProvider } from "@/store/settingsSlice";
import { authenticated } from "@/store/authSlice";
import { apiPaymentStatus } from "@/lib/auth-client";
import type { LlmProvider } from "@/lib/llm/types";

type PayNotice = { type: "success" | "pending" | "fail"; text: string };

export default function ChatPage() {
  const error = useAppSelector((s) => s.chat.error);
  const activeId = useAppSelector((s) => s.chat.activeId);
  const provider = useAppSelector((s) => s.settings.provider);
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

  const handleDelete = () => {
    if (!activeId) return;
    dispatch(deleteConversation(activeId));
  };

  return (
    <>
      <Group justify="space-between" mb="md" wrap="nowrap">
        <Title order={2} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </Title>
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          {/* Переключатель движка модели: Claude (Anthropic) / GLM (Z.ai). Выбор
              персистится в настройках и едет в /api/chat как provider. */}
          <Tooltip label="Какой моделью отвечать">
            <SegmentedControl
              size="xs"
              radius="md"
              color="brand"
              value={provider}
              onChange={(v) => dispatch(setProvider(v as LlmProvider))}
              data={[
                { label: "Claude", value: "claude" },
                { label: "GLM", value: "glm" },
              ]}
            />
          </Tooltip>
          {activeId && (
            <Tooltip label="Удалить чат">
              <ActionIcon
                variant="light"
                color="red"
                size="lg"
                onClick={handleDelete}
              >
                <IconTrash size={18} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
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
          отдельным мягким блоком снизу (см. ChatInput). На тёмной теме это
          убирает резкие серые линии. */}
      <Box>
        <ChatWindow />
        <ChatInput />
      </Box>
    </>
  );
}
