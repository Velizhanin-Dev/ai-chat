"use client";

import { Paper, Title, Alert, Group, ActionIcon, Tooltip } from "@mantine/core";
import { IconAlertCircle, IconTrash } from "@tabler/icons-react";
import ChatWindow from "@/components/Chat/ChatWindow";
import ChatInput from "@/components/Chat/ChatInput";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { deleteConversation } from "@/store/chatSlice";

export default function ChatPage() {
  const error = useAppSelector((s) => s.chat.error);
  const activeId = useAppSelector((s) => s.chat.activeId);
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

      <Paper shadow="sm" radius="md" withBorder style={{ overflow: "hidden" }}>
        <ChatWindow />
        <ChatInput />
      </Paper>
    </>
  );
}
