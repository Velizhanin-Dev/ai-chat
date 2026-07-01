"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setActiveConversation } from "@/store/chatSlice";
import { writeLastProject } from "@/lib/last-project";

// Маршруты проекта несут projectId в URL (/{projectId}/chat|channel|…). Источник
// правды «какой проект открыт» — URL; здесь синхронизируем его в стор (activeId),
// чтобы сайдбар/ChatWindow/ChatInput (читают activeId) показывали нужный проект.
// Авторизацию гейтит middleware; роль для закрытых разделов — гвард (locked).
export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const projectId =
    typeof params.projectId === "string" ? params.projectId : null;
  const dispatch = useAppDispatch();
  const router = useRouter();
  const hydrated = useAppSelector((s) => s.chat.hydrated);
  const userId = useAppSelector((s) => s.auth.user?.id ?? null);
  // Есть ли такой проект у юзера (после гидратации списка из БД).
  const exists = useAppSelector((s) =>
    projectId ? s.chat.conversations.some((c) => c.id === projectId) : false
  );

  // Синхронизируем activeId с URL, как только проект подтверждён в списке, и
  // запоминаем его как «последний» (для редиректа с /app в след. заход).
  // setActiveConversation — no-op, пока проекта нет в сторе (до гидратации),
  // поэтому зависим от exists и повторяем после загрузки списка.
  useEffect(() => {
    if (projectId && exists) {
      dispatch(setActiveConversation(projectId));
      if (userId) writeLastProject(userId, projectId);
    }
  }, [projectId, exists, userId, dispatch]);

  // Проект чужой/удалён (после гидратации в списке его нет) — уводим на экран
  // выбора. Данные и так защищены (API проверяет владение), это про навигацию/UX.
  useEffect(() => {
    if (hydrated && projectId && !exists) router.replace("/app");
  }, [hydrated, projectId, exists, router]);

  return <>{children}</>;
}
