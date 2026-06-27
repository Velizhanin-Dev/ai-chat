"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  ThemeIcon,
  Modal,
  TextInput,
  Loader,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconTrash,
  IconPencil,
  IconCheck,
  IconX,
  IconFolderPlus,
} from "@tabler/icons-react";
import ChatWindow from "@/components/Chat/ChatWindow";
import ChatInput from "@/components/Chat/ChatInput";
import SubscriptionModal from "@/components/Billing/SubscriptionModal";
import BriefFlow from "@/components/Brief/BriefFlow";
import { useChatAccess } from "@/hooks/useChatAccess";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import {
  setMessagesLoading,
  setConversationMessages,
  deleteConversation,
  renameConversation,
  addProject,
  startBriefing,
  finishBriefing,
} from "@/store/chatSlice";
import {
  apiGetMessages,
  apiDeleteConversation,
  apiRenameConversation,
  apiCreateProject,
} from "@/lib/chat-client";
import { readAnonBrief, clearAnonBrief } from "@/lib/anon-brief";
import { ymGoal } from "@/lib/metrika";
import type { Brief } from "@/lib/brief";

// Черновик брифа нового проекта (восстанавливается при перезагрузке в процессе).
const PROJECT_BRIEF_DRAFT_KEY = "creative-chat:project-brief-draft-v1";

export default function ChatPage() {
  const dispatch = useAppDispatch();
  const error = useAppSelector((s) => s.chat.error);
  const activeId = useAppSelector((s) => s.chat.activeId);
  const drafting = useAppSelector((s) => s.chat.drafting);
  const conversations = useAppSelector((s) => s.chat.conversations);
  const userId = useAppSelector((s) => s.auth.user?.id ?? null);
  const activeConv = conversations.find((c) => c.id === activeId) ?? null;
  const activeLoaded = activeConv?.messagesLoaded ?? true;
  const title = activeConv?.title ?? "Новый проект";

  // Доступ к чату: тариф истёк / кончились запросы → блокировка + модалка тарифов.
  const access = useChatAccess();
  const [subModalOpen, setSubModalOpen] = useState(false);
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    // Во время брифа модалку блокировки не показываем (она перекрыла бы визард).
    if (access.ready && access.locked && !drafting && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setSubModalOpen(true);
    }
    if (!access.locked) autoOpenedRef.current = false;
  }, [access.ready, access.locked, drafting]);

  // Лимит проектов по тарифу: больше слотов не создать, пока не удалишь проект.
  const projectsLimit = access.projectsLimit;
  const atProjectLimit =
    projectsLimit != null && projectsLimit >= 0 && conversations.length >= projectsLimit;

  // Ленивая подгрузка сообщений при открытии проекта из списка.
  useEffect(() => {
    if (!activeId || activeLoaded) return;
    const id = activeId;
    dispatch(setMessagesLoading(true));
    void apiGetMessages(id).then((res) => {
      if (res.ok) dispatch(setConversationMessages({ id, messages: res.data }));
      else dispatch(setMessagesLoading(false));
    });
  }, [activeId, activeLoaded, dispatch]);

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
    if (!activeId || !next || next === title) return;
    dispatch(renameConversation({ id: activeId, title: next }));
    void apiRenameConversation(activeId, next);
  };

  // ── Удаление проекта (модалка подтверждения) ───────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const confirmDelete = () => {
    if (!activeId) return;
    const id = activeId;
    dispatch(deleteConversation(id));
    void apiDeleteConversation(id);
    setDeleteOpen(false);
  };

  // ── Создание проекта: бриф → POST → проект → чат ───────────────────────────
  const createProject = useCallback(
    async (brief: Brief): Promise<{ ok: boolean; error?: string }> => {
      const res = await apiCreateProject(brief);
      if (!res.ok) return { ok: false, error: res.error };
      dispatch(addProject(res.data));
      clearAnonBrief(); // анонимный бриф (если был с QR) использован — чистим
      ymGoal("brief_complete", { disc: brief.disc, source: "project" });
      return { ok: true };
    },
    [dispatch]
  );
  const handleBriefSubmit = createProject;

  // Если бриф уже пройден на /brief (анонимный бриф в localStorage) — не показываем
  // визард повторно, а сразу создаём проект и открываем чат. На ошибке (или нет
  // анона) откатываемся к обычному визарду (с пре-филлом). readAnonBrief отдаёт
  // только ЗАВЕРШЁННЫЙ бриф (с DISC), иначе null.
  const [creating, setCreating] = useState(false);
  const autoTriedRef = useRef(false);
  useEffect(() => {
    if (!drafting) {
      autoTriedRef.current = false;
      return;
    }
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    const anon = readAnonBrief();
    if (!anon) return;
    setCreating(true);
    void createProject(anon).then((res) => {
      setCreating(false);
      if (res.ok) dispatch(finishBriefing());
      // не вышло — остаёмся в drafting, покажется визард с пре-филлом
    });
  }, [drafting, createProject, dispatch]);

  return (
    <>
      {/* Заголовок проекта + действия (правка названия / удаление) — только когда
          открыт проект и мы не в брифе. */}
      {activeId && !drafting && (
        <Group
          justify="space-between"
          mb={{ base: "xs", sm: "md" }}
          wrap="nowrap"
          gap="xs"
          style={{ flexShrink: 0 }}
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
              style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
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
                  <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => setEditing(false)}>
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
                  <ActionIcon variant="light" color="red" size="lg" onClick={() => setDeleteOpen(true)}>
                    <IconTrash size={18} />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
          </Group>
        </Group>
      )}

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} title="Ошибка" color="red" mb="md" withCloseButton>
          {error}
        </Alert>
      )}

      <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {drafting && creating ? (
          // Бриф уже пройден (с /brief) — молча создаём проект, показываем лоадер.
          <Box style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Loader color="brand" />
          </Box>
        ) : drafting ? (
          // Бриф нового проекта — на месте окна чата. После прохождения откроется чат.
          <Box style={{ flex: 1, overflowY: "auto", minHeight: 0 }} py="md">
            <Box maw={560} mx="auto" px={{ base: 4, sm: 0 }}>
              <Title order={2} className="lp-h2" fz={{ base: "1.35rem", sm: "1.6rem" }} mb={4}>
                Новый проект
              </Title>
              <Text c="dimmed" size="sm" mb="lg">
                Пара вопросов о проекте и короткий тест — на их основе я буду собирать
                контент именно под него.
              </Text>
              <BriefFlow
                initialBrief={readAnonBrief()}
                draftKey={PROJECT_BRIEF_DRAFT_KEY}
                draftScope={userId ?? "anon"}
                onSubmit={handleBriefSubmit}
                resultNote={
                  <Text size="sm" c="dimmed">
                    Готово — бриф проекта сохранён. Можно начинать.
                  </Text>
                }
                resultActions={() => (
                  <Button color="brand" radius="md" onClick={() => dispatch(finishBriefing())}>
                    Поехали в чат
                  </Button>
                )}
              />
            </Box>
          </Box>
        ) : activeId ? (
          <>
            <ChatWindow />
            <ChatInput
              locked={access.locked}
              lockReason={access.reason}
              onUpgrade={() => setSubModalOpen(true)}
            />
          </>
        ) : (
          // Нет открытого проекта — приглашение создать.
          <Box style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Stack align="center" gap="md" maw={420} px="md" ta="center">
              <ThemeIcon color="brand" variant="light" radius="xl" size={56}>
                <IconFolderPlus size={28} />
              </ThemeIcon>
              <Title order={3}>
                {conversations.length === 0 ? "Создайте первый проект" : "Выберите проект"}
              </Title>
              <Text c="dimmed">
                {conversations.length === 0
                  ? "Каждый проект — это отдельный канал/продукт со своим брифом. Начните с короткого знакомства."
                  : "Откройте проект слева или создайте новый."}
              </Text>
              <Tooltip
                label={`Лимит проектов на тарифе: ${projectsLimit}. Удалите проект, чтобы создать новый.`}
                disabled={!atProjectLimit}
                multiline
                w={240}
              >
                <Button
                  color="brand"
                  radius="md"
                  leftSection={<IconFolderPlus size={18} />}
                  disabled={atProjectLimit}
                  onClick={() => dispatch(startBriefing())}
                >
                  Новый проект
                </Button>
              </Tooltip>
            </Stack>
          </Box>
        )}
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
            <Button variant="subtle" color="gray" radius="md" onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
            <Button color="red" radius="md" leftSection={<IconTrash size={16} />} onClick={confirmDelete}>
              Удалить
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
