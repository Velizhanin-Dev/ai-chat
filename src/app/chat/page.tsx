"use client";

import { Paper, Title, Alert, Group, ActionIcon, Tooltip, SegmentedControl } from "@mantine/core";
import { IconAlertCircle, IconTrash } from "@tabler/icons-react";
import ChatWindow from "@/components/Chat/ChatWindow";
import ChatInput from "@/components/Chat/ChatInput";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { resetChat, setModel, ChatModel } from "@/store/chatSlice";

export default function ChatPage() {
  const error = useAppSelector((s) => s.chat.error);
  const messagesCount = useAppSelector((s) => s.chat.messages.length);
  const model = useAppSelector((s) => s.chat.model);
  const isLoading = useAppSelector((s) => s.chat.isLoading);
  const dispatch = useAppDispatch();

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>Чат</Title>
        <Group gap="sm">
          <SegmentedControl
            size="sm"
            value={model}
            onChange={(v) => dispatch(setModel(v as ChatModel))}
            disabled={isLoading}
            data={[
              { label: "Обычная", value: "fast" },
              { label: "Более умная", value: "smart" },
            ]}
          />
          {messagesCount > 0 && (
            <Tooltip label="Новый чат">
              <ActionIcon
                variant="light"
                color="red"
                size="lg"
                onClick={() => dispatch(resetChat())}
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

      <Paper shadow="sm" radius="md" withBorder style={{ overflow: "hidden" }}>
        <ChatWindow />
        <ChatInput />
      </Paper>
    </>
  );
}
