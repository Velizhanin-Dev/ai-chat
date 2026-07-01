"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Title,
  Text,
  Stack,
  ThemeIcon,
  Button,
  Loader,
  Center,
} from "@mantine/core";
import { IconFolderPlus } from "@tabler/icons-react";
import BriefFlow from "@/components/Brief/BriefFlow";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { addProject, startBriefing, finishBriefing } from "@/store/chatSlice";
import { apiCreateProject } from "@/lib/chat-client";
import { readLastProject } from "@/lib/last-project";
import { readAnonBrief, clearAnonBrief } from "@/lib/anon-brief";
import { ymGoal } from "@/lib/metrika";
import type { Brief } from "@/lib/brief";

// Черновик брифа нового проекта (восстанавливается при перезагрузке в процессе).
const PROJECT_BRIEF_DRAFT_KEY = "creative-chat:project-brief-draft-v1";

// Экран приложения без выбранного проекта: создать/выбрать проект + визард брифа.
// Создание проекта (после брифа) уводит в чат проекта (/{id}/chat).
export default function AppHomePage() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const drafting = useAppSelector((s) => s.chat.drafting);
  const conversations = useAppSelector((s) => s.chat.conversations);
  const userId = useAppSelector((s) => s.auth.user?.id ?? null);
  const hydrated = useAppSelector((s) => s.chat.hydrated);

  // Если проекты уже есть — /app не задерживаем, уводим на последний открытый
  // (или самый свежий по обновлению). Экран создания остаётся только когда
  // проектов нет, и режим брифа (создание нового) редирект не трогает.
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (!hydrated || drafting || conversations.length === 0) return;
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    const last = userId ? readLastProject(userId) : null;
    const target =
      last && conversations.some((c) => c.id === last)
        ? last
        : [...conversations].sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt)
          )[0].id;
    router.replace(`/${target}/chat`);
  }, [hydrated, drafting, conversations, userId, router]);

  // Созданный проект (для кнопки «Поехали в чат» на экране результата брифа).
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Бриф пройден в визарде → создаём проект, показываем экран результата (архетип),
  // переход в чат — по кнопке (см. resultActions ниже).
  const handleBriefSubmit = useCallback(
    async (brief: Brief): Promise<{ ok: boolean; error?: string }> => {
      const res = await apiCreateProject(brief);
      if (!res.ok) return { ok: false, error: res.error };
      dispatch(addProject(res.data));
      clearAnonBrief();
      ymGoal("brief_complete", { disc: brief.disc, source: "project" });
      setCreatedId(res.data.id);
      return { ok: true };
    },
    [dispatch]
  );

  // Если бриф уже пройден на /brief (анонимный бриф в localStorage) — не показываем
  // визард повторно, а сразу создаём проект и уходим в чат. На ошибке (или нет
  // анона) откатываемся к обычному визарду (с пре-филлом).
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
    void apiCreateProject(anon).then((res) => {
      setCreating(false);
      if (res.ok) {
        dispatch(addProject(res.data));
        clearAnonBrief();
        ymGoal("brief_complete", { disc: anon.disc, source: "qr" });
        dispatch(finishBriefing());
        router.push(`/${res.data.id}/chat`);
      }
      // не вышло — остаёмся в drafting, покажется визард с пре-филлом
    });
  }, [drafting, dispatch, router]);

  if (drafting && creating) {
    // Бриф уже пройден (с /brief) — молча создаём проект, показываем лоадер.
    return (
      <Center style={{ flex: 1 }}>
        <Loader color="brand" />
      </Center>
    );
  }

  if (drafting) {
    // Бриф нового проекта. После прохождения — экран результата + «Поехали в чат».
    return (
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
              <Button
                color="brand"
                radius="md"
                onClick={() => {
                  dispatch(finishBriefing());
                  if (createdId) router.push(`/${createdId}/chat`);
                }}
              >
                Поехали в чат
              </Button>
            )}
          />
        </Box>
      </Box>
    );
  }

  // Не в режиме брифа: список ещё грузится или редиректим на существующий проект
  // (см. эффект выше) — показываем лоадер. Экран создания первого проекта
  // показываем только когда точно известно, что проектов нет.
  if (!hydrated || conversations.length > 0) {
    return (
      <Center style={{ flex: 1 }}>
        <Loader color="brand" />
      </Center>
    );
  }

  // Проектов нет — приглашение создать первый.
  return (
    <Box style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Stack align="center" gap="md" maw={420} px="md" ta="center">
        <ThemeIcon color="brand" variant="light" radius="xl" size={56}>
          <IconFolderPlus size={28} />
        </ThemeIcon>
        <Title order={3}>Создайте первый проект</Title>
        <Text c="dimmed">
          Каждый проект — это отдельный канал/продукт со своим брифом. Начните с
          короткого знакомства.
        </Text>
        <Button
          color="brand"
          radius="md"
          leftSection={<IconFolderPlus size={18} />}
          onClick={() => dispatch(startBriefing())}
        >
          Новый проект
        </Button>
      </Stack>
    </Box>
  );
}
