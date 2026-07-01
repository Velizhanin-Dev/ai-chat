"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Box,
  Title,
  Alert,
  Group,
  ActionIcon,
  Tooltip,
  Button,
  Text,
  Stack,
  Modal,
  TextInput,
  Center,
  Loader,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconTrash,
  IconPencil,
  IconCheck,
  IconX,
} from "@tabler/icons-react";
import ChatWindow from "@/components/Chat/ChatWindow";
import ChatInput from "@/components/Chat/ChatInput";
import SubscriptionModal from "@/components/Billing/SubscriptionModal";
import { useChatAccess } from "@/hooks/useChatAccess";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import {
  setMessagesLoading,
  setConversationMessages,
  deleteConversation,
  renameConversation,
} from "@/store/chatSlice";
import {
  apiGetMessages,
  apiDeleteConversation,
  apiRenameConversation,
} from "@/lib/chat-client";

// Чат конкретного проекта (/{projectId}/chat). projectId — из URL; activeId стора
// синхронит ProjectLayout. Бриф/создание проекта живёт на /app (не здесь).
export default function ProjectChatPage() {
  const params = useParams();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  const router = useRouter();
  const dispatch = useAppDispatch();

  const error = useAppSelector((s) => s.chat.error);
  const activeId = useAppSelector((s) => s.chat.activeId);
  const conversations = useAppSelector((s) => s.chat.conversations);
  const hydrated = useAppSelector((s) => s.chat.hydrated);
  const activeConv = conversations.find((c) => c.id === projectId) ?? null;
  const activeLoaded = activeConv?.messagesLoaded ?? false;
  const title = activeConv?.title ?? "Проект";
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

  // ── Переименование проекта (инлайн рядом с заголовком) ─────────────────────
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const startRename = () => {
    setTitleDraft(title);
    setEditing(true);
  };
  const saveRename = () => {
    const next = titleDraft.trim();
    setEditing(false);
    if (!projectId || !next || next === title) return;
    dispatch(renameConversation({ id: projectId, title: next }));
    void apiRenameConversation(projectId, next);
  };

  // ── Удаление проекта (модалка подтверждения) → на экран выбора ──────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const confirmDelete = () => {
    if (!projectId) return;
    dispatch(deleteConversation(projectId));
    void apiDeleteConversation(projectId);
    setDeleteOpen(false);
    router.push("/app");
  };

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
      {/* Заголовок проекта + действия (правка названия / удаление). На мобиле/iPad
          меню рендерится внутри колонки (см. AppShell) — order:-1 поднимает заголовок
          НАД меню. На десктопе меню сверху отдельной полосой, order безвреден. */}
      <Group
        justify="space-between"
        mb={{ base: "xs", sm: "md" }}
        wrap="nowrap"
        gap="xs"
        style={{ flexShrink: 0, order: -1 }}
      >
        {editing ? (
          <TextInput
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveRename();
              if (e.key === "Escape") setEditing(false);
            }}
            onBlur={saveRename}
            autoFocus
            maxLength={80}
            size="md"
            style={{ flex: 1, minWidth: 0 }}
          />
        ) : (
          <Title
            order={2}
            fz={{ base: "1.35rem", sm: "1.75rem" }}
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </Title>
        )}
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          {editing ? (
            <>
              <Tooltip label="Сохранить">
                <ActionIcon variant="light" color="brand" size="lg" onClick={saveRename}>
                  <IconCheck size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Отмена">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  onClick={() => setEditing(false)}
                >
                  <IconX size={18} />
                </ActionIcon>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip label="Переименовать проект">
                <ActionIcon variant="subtle" color="gray" size="lg" onClick={startRename}>
                  <IconPencil size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Удалить проект">
                <ActionIcon
                  variant="light"
                  color="red"
                  size="lg"
                  onClick={() => setDeleteOpen(true)}
                >
                  <IconTrash size={18} />
                </ActionIcon>
              </Tooltip>
            </>
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

      <Modal
        opened={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={<Text fw={600}>Удалить проект?</Text>}
        centered
        radius="lg"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Проект «{title}» и вся его переписка будут удалены без возможности
            восстановления. Освободится слот — можно создать новый проект.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="subtle"
              color="gray"
              radius="md"
              onClick={() => setDeleteOpen(false)}
            >
              Отмена
            </Button>
            <Button
              color="red"
              radius="md"
              leftSection={<IconTrash size={16} />}
              onClick={confirmDelete}
            >
              Удалить
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
