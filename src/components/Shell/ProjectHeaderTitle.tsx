"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconCheck, IconPencil, IconTrash, IconX } from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { deleteConversation, renameConversation } from "@/store/chatSlice";
import { apiDeleteConversation, apiRenameConversation } from "@/lib/chat-client";

// Название текущего проекта и действия над ним (переименовать / удалить) — в
// ШАПКЕ приложения. Раньше это была отдельная строка-заголовок на странице чата,
// но она дублировала название, уже видное в шапке, и съедала высоту на телефоне.
// Теперь заголовок один, а действия доступны из любого раздела проекта.
//
// Части разнесены по краям шапки: название — слева, рядом с логотипом
// (ProjectHeaderTitle); кнопки — справа, рядом с кружком квоты
// (ProjectHeaderActions). Общее состояние (режим правки, модалка удаления)
// живёт в провайдере ниже, поэтому обе части остаются согласованными.
//
// Проект берём из URL (/{projectId}/...): на /app параметра нет — рендерим null.

interface Ctx {
  projectId: string;
  title: string;
  exists: boolean;
  editing: boolean;
  draft: string;
  setDraft: (v: string) => void;
  startRename: () => void;
  saveRename: () => void;
  cancelRename: () => void;
  openDelete: () => void;
}

const ProjectHeaderCtx = createContext<Ctx | null>(null);

export function ProjectHeaderProvider({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";
  const router = useRouter();
  const dispatch = useAppDispatch();

  const conversations = useAppSelector((s) => s.chat.conversations);
  const conv = conversations.find((c) => c.id === projectId) ?? null;
  const title = conv?.title ?? "";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const value = useMemo<Ctx>(
    () => ({
      projectId,
      title,
      exists: Boolean(projectId && conv),
      editing,
      draft,
      setDraft,
      startRename: () => {
        setDraft(title);
        setEditing(true);
      },
      saveRename: () => {
        const next = draft.trim();
        setEditing(false);
        if (!projectId || !next || next === title) return;
        dispatch(renameConversation({ id: projectId, title: next }));
        void apiRenameConversation(projectId, next);
      },
      cancelRename: () => setEditing(false),
      openDelete: () => setDeleteOpen(true),
    }),
    [projectId, title, conv, editing, draft, dispatch]
  );

  const confirmDelete = () => {
    if (!projectId) return;
    dispatch(deleteConversation(projectId));
    void apiDeleteConversation(projectId);
    setDeleteOpen(false);
    router.push("/app");
  };

  return (
    <ProjectHeaderCtx.Provider value={value}>
      {children}
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
    </ProjectHeaderCtx.Provider>
  );
}

// Левая часть шапки: название проекта (в режиме правки — поле ввода).
export function ProjectHeaderTitle() {
  const ctx = useContext(ProjectHeaderCtx);
  if (!ctx?.exists) return null;

  if (ctx.editing) {
    return (
      <TextInput
        value={ctx.draft}
        onChange={(e) => ctx.setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") ctx.saveRename();
          if (e.key === "Escape") ctx.cancelRename();
        }}
        autoFocus
        maxLength={80}
        size="xs"
        style={{ flex: 1, minWidth: 0 }}
      />
    );
  }

  // Кегль на десктопе — как у логотипа (lg): при РАЗНЫХ размерах шрифта центры
  // строк не совпадают, и название визуально «проваливалось» ниже «VELIZHANIN AI».
  // Вес и цвет мягче, чтобы бренд оставался главным. На мобиле логотип — только
  // знак, сравнивать не с чем, поэтому там компактный sm.
  return (
    <Text
      fw={500}
      fz={{ base: "sm", lg: "lg" }}
      c="dimmed"
      truncate
      style={{ minWidth: 0 }}
    >
      {ctx.title}
    </Text>
  );
}

// Правая часть шапки: действия над проектом — рядом с кружком квоты.
export function ProjectHeaderActions() {
  const ctx = useContext(ProjectHeaderCtx);
  if (!ctx?.exists) return null;

  if (ctx.editing) {
    return (
      <>
        <Tooltip label="Сохранить">
          <ActionIcon variant="light" color="brand" size="md" onClick={ctx.saveRename}>
            <IconCheck size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Отмена">
          <ActionIcon variant="subtle" color="gray" size="md" onClick={ctx.cancelRename}>
            <IconX size={16} />
          </ActionIcon>
        </Tooltip>
      </>
    );
  }

  return (
    <>
      <Tooltip label="Переименовать проект">
        <ActionIcon
          variant="subtle"
          color="gray"
          size="md"
          onClick={ctx.startRename}
          aria-label="Переименовать проект"
        >
          <IconPencil size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Удалить проект">
        <ActionIcon
          variant="subtle"
          color="red"
          size="md"
          onClick={ctx.openDelete}
          aria-label="Удалить проект"
        >
          <IconTrash size={16} />
        </ActionIcon>
      </Tooltip>
    </>
  );
}
