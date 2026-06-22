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
import { IconAlertCircle, IconTrash } from "@tabler/icons-react";
import ChatWindow from "@/components/Chat/ChatWindow";
import ChatInput from "@/components/Chat/ChatInput";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { deleteConversation } from "@/store/chatSlice";
import { setProvider } from "@/store/settingsSlice";
import type { LlmProvider } from "@/lib/llm/types";

export default function ChatPage() {
  const error = useAppSelector((s) => s.chat.error);
  const activeId = useAppSelector((s) => s.chat.activeId);
  const provider = useAppSelector((s) => s.settings.provider);
  const title = useAppSelector(
    (s) =>
      s.chat.conversations.find((c) => c.id === s.chat.activeId)?.title ?? "Новый чат"
  );
  const dispatch = useAppDispatch();

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
