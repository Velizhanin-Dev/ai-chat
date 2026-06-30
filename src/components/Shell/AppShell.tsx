"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AppShell,
  Burger,
  Group,
  Box,
  Stack,
  Divider,
  UnstyledButton,
  Avatar,
  Text,
  ActionIcon,
  Tooltip,
  Button,
  Menu,
  ScrollArea,
  Skeleton,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconSun,
  IconMoon,
  IconChevronRight,
  IconLogout,
  IconSettings,
  IconPlus,
  IconMessageCircle,
  IconShieldLock,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { loggedOut } from "@/store/authSlice";
import { apiLogout } from "@/lib/auth-client";
import { readIntendedPlan, clearIntendedPlan } from "@/lib/intended-plan";
import { readLastProject, writeLastProject } from "@/lib/last-project";
import { useChatAccess } from "@/hooks/useChatAccess";
import {
  startBriefing,
  setActiveConversation,
  hydrate,
  resetChat,
} from "@/store/chatSlice";
import {
  apiListConversations,
  migrateLocalConversations,
} from "@/lib/chat-client";
import Logo from "@/components/Brand/Logo";
import RequestsRing from "@/components/Chat/RequestsRing";
import SettingsModal from "@/components/Settings/SettingsModal";

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [opened, { toggle, close }] = useDisclosure();
  const [settingsOpened, { open: openSettings, close: closeSettings }] =
    useDisclosure(false);
  // Вкладка, на которой открыть настройки (по умолчанию «Основные»; "billing" —
  // при приходе с «Оформить» лендинга, см. эффект intended-plan ниже).
  const [settingsTab, setSettingsTab] = useState("general");
  const openSettingsOn = (tab: string) => {
    setSettingsTab(tab);
    openSettings();
  };
  const pathname = usePathname();
  const router = useRouter();
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light", {
    getInitialValueInEffect: true,
  });
  // Иконку темы рисуем только после маунта — см. подробный комментарий в
  // LandingNav. getInitialValueInEffect не покрывает случай явно сохранённой в
  // localStorage темы (читается синхронно), поэтому добавляем mount-гейт.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const user = useAppSelector((s) => s.auth.user);
  const authReady = useAppSelector((s) => s.auth.ready);
  // Доступ к чату (срок/квота) — чтобы при блокировке не дублировать окно тарифов:
  // у заблокированного юзера тарифы показывает модалка «Подписка закончилась».
  const access = useChatAccess();
  const conversations = useAppSelector((s) => s.chat.conversations);
  const activeId = useAppSelector((s) => s.chat.activeId);
  const chatHydratedFlag = useAppSelector((s) => s.chat.hydrated);
  const dispatch = useAppDispatch();

  // ── Загрузка истории чата из БД (кросс-девайсно) ───────────────────────
  // Источник правды по диалогам — БД. При входе (или смене юзера) разово
  // переносим старую localStorage-историю в БД, затем тянем список диалогов
  // (метаданными; сообщения грузятся лениво при открытии). На логауте — сброс.
  // Грузим один раз на юзера (ref-гард), эффект переживает клиентскую навигацию
  // (AppShell в layout, не размонтируется).
  const loadedForUser = useRef<string | null>(null);
  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      if (loadedForUser.current !== null) {
        dispatch(resetChat());
        loadedForUser.current = null;
      } else {
        // Гость на первом рендере — снимаем скелетоны (известно: истории нет).
        dispatch(resetChat());
      }
      return;
    }
    if (loadedForUser.current === user.id) return;
    loadedForUser.current = user.id;
    void (async () => {
      await migrateLocalConversations();
      // Ретрай на транзиентный сбой (таймаут/обрыв сети), чтобы не показать пустой
      // список там, где проекты есть. apiListConversations теперь с таймаутом —
      // зависнуть не может, поэтому цикл конечен.
      let res = await apiListConversations();
      for (let attempt = 0; !res.ok && attempt < 2; attempt++) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        res = await apiListConversations();
      }
      if (res.ok) {
        dispatch(hydrate({ conversations: res.data }));
        // Авто-открываем последний активный проект (если он ещё существует).
        const last = readLastProject(user.id);
        if (last && res.data.some((c) => c.id === last)) {
          dispatch(setActiveConversation(last));
        }
      } else {
        // Не достучались даже с ретраями — снимаем скелетон (не вечный лоадер) и
        // разрешаем повторную загрузку при следующем триггере эффекта (смена юзера).
        dispatch(resetChat());
        loadedForUser.current = null;
      }
    })();
  }, [authReady, user?.id, dispatch]);

  // Запоминаем активный проект в localStorage (для авто-открытия в след. заход).
  useEffect(() => {
    if (user?.id && activeId) writeLastProject(user.id, activeId);
  }, [user?.id, activeId]);

  // Намерение оформить тариф с лендинга («Оформить» → /chat): один раз открываем
  // настройки на вкладке «Биллинг» и чистим флаг (повторно не всплывёт). Ждём
  // залогиненного юзера (гость уходит на /login и вернётся уже авторизованным).
  // Зависим и от pathname: AppShell живёт в layout и НЕ размонтируется при
  // переходе лендинг → /chat, поэтому ловим флаг на смене маршрута (а не только
  // на смене юзера). Гость уходит на /login и вернётся уже авторизованным.
  const intendedPlanChecked = useRef(false);
  useEffect(() => {
    if (intendedPlanChecked.current || !user) return;
    // Ждём, пока известно состояние доступа (срок/квота) — иначе не отличим
    // заблокированного юзера от активного.
    if (!access.ready) return;
    if (readIntendedPlan()) {
      intendedPlanChecked.current = true;
      clearIntendedPlan();
      // Заблокирован (нет активной подписки) → тарифы покажет модалка «Подписка
      // закончилась» (chat/page), второе окно не открываем. Активному — биллинг.
      if (!access.locked) openSettingsOn("billing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, pathname, access.ready, access.locked]);

  // Бриф теперь крепится к ПРОЕКТУ (создаётся при «Новый проект», см. chat/page),
  // обязательной модалки брифа при входе больше нет. Чат-обвязку (сайдбар/шапка)
  // навешиваем ТОЛЬКО на /chat — всё остальное (лендинг, auth, /admin, /legal,
  // /brief, /payment, а также 404/500) рендерится «голым», своим layout.
  const onBareRoute = !(pathname === "/chat" || pathname.startsWith("/chat/"));

  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === "dark" ? "light" : "dark");
  };

  const handleLogout = async () => {
    await apiLogout(); // гасим серверную cookie
    dispatch(loggedOut());
    router.push("/");
  };

  // Лимит проектов по тарифу: больше слотов создать нельзя, пока не удалишь проект.
  const projectsLimit = access.projectsLimit;
  const atProjectLimit =
    projectsLimit != null && projectsLimit >= 0 && conversations.length >= projectsLimit;

  const handleNewProject = () => {
    if (atProjectLimit) return;
    // Проект создаётся после прохождения брифа (см. chat/page) — входим в режим брифа.
    dispatch(startBriefing());
    if (pathname !== "/chat") router.push("/chat");
    close();
  };

  const handleSelect = (id: string) => {
    dispatch(setActiveConversation(id));
    close();
  };

  // Лендинг, auth-страницы и админка рендерятся без чат-сайдбара/шапки.
  if (onBareRoute) {
    return <>{children}</>;
  }

  // Свежие сверху (addMessage обновляет updatedAt, но порядок в массиве не трогает).
  const sorted = [...conversations].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );

  return (
    <>
      <SettingsModal
        opened={settingsOpened}
        onClose={closeSettings}
        initialTab={settingsTab}
      />
      <AppShell
        header={{ height: 60 }}
        // Бургер-режим (сайдбар оверлеем) держим вплоть до iPad: постоянный
        // сайдбар появляется только на десктопе (≥ lg = 1200px). На планшетах
        // и телефонах — бургер. Все hiddenFrom/visibleFrom ниже синхронны с lg.
        navbar={{ width: 280, breakpoint: "lg", collapsed: { mobile: !opened } }}
        padding={{ base: "xs", sm: "md" }}
      >
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Group gap="sm">
              <Burger opened={opened} onClick={toggle} hiddenFrom="lg" size="sm" />
              <Logo href="/" />
            </Group>
            {/* Кружок остатка квоты запросов (как в Claude Code). */}
            <RequestsRing />
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="sm">
          <AppShell.Section>
            {/* На десктопе «Новый проект» сверху; на мобиле — крупной CTA внизу
                дравера (см. нижнюю секцию). Блокируем при достижении лимита тарифа. */}
            <Tooltip
              label={`Лимит проектов на тарифе: ${projectsLimit}. Удалите проект, чтобы создать новый.`}
              disabled={!atProjectLimit}
              multiline
              w={240}
            >
              <Button
                fullWidth
                radius="md"
                color="brand"
                leftSection={<IconPlus size={18} />}
                onClick={handleNewProject}
                disabled={atProjectLimit}
                mb="sm"
                visibleFrom="lg"
              >
                Новый проект
              </Button>
            </Tooltip>
            <Text size="xs" c="dimmed" px={4} mb={4}>
              Мои проекты
            </Text>
          </AppShell.Section>

          <AppShell.Section grow component={ScrollArea} type="hover">
            <Stack gap={2}>
              {/* До гидратации из localStorage показываем скелетоны, а не
                  ложное «Пока нет диалогов». */}
              {!chatHydratedFlag &&
                Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} height={34} radius="sm" mb={2} />
                ))}
              {chatHydratedFlag && sorted.length === 0 && (
                <Text size="xs" c="dimmed" ta="center" py="md">
                  Пока нет проектов
                </Text>
              )}
              {chatHydratedFlag &&
                sorted.map((conv) => {
                const active = conv.id === activeId;
                return (
                  <UnstyledButton
                    key={conv.id}
                    onClick={() => handleSelect(conv.id)}
                    p="xs"
                    style={{
                      borderRadius: 8,
                      background: active
                        ? "var(--mantine-color-brand-light)"
                        : "transparent",
                    }}
                  >
                    <Group gap="xs" wrap="nowrap">
                      <IconMessageCircle
                        size={16}
                        style={{
                          flexShrink: 0,
                          color: active
                            ? "var(--mantine-color-brand-filled)"
                            : "var(--mantine-color-dimmed)",
                        }}
                      />
                      <Text
                        size="sm"
                        truncate
                        style={{ flex: 1 }}
                        c={active ? undefined : "dimmed"}
                        fw={active ? 500 : 400}
                      >
                        {conv.title}
                      </Text>
                      {/* Удаление/переименование проекта — в шапке самого проекта
                          (chat/page), не в списке. */}
                    </Group>
                  </UnstyledButton>
                );
              })}
            </Stack>
          </AppShell.Section>

          <AppShell.Section>
            {/* Мобильная CTA: крупная кнопка «Новый проект» внизу дравера. */}
            <Button
              fullWidth
              size="lg"
              radius="md"
              color="brand"
              leftSection={<IconPlus size={20} />}
              onClick={handleNewProject}
              disabled={atProjectLimit}
              mb="sm"
              hiddenFrom="lg"
            >
              Новый проект
            </Button>

            <Divider mb="sm" />

            <Group justify="space-between" px={4} mb="sm">
              <Text size="xs" c="dimmed">
                Тема
              </Text>
              <Tooltip
                label={computedColorScheme === "dark" ? "Светлая тема" : "Тёмная тема"}
              >
                <ActionIcon
                  variant="default"
                  size="lg"
                  radius="md"
                  onClick={toggleColorScheme}
                  aria-label="Переключить тему"
                >
                  {mounted && computedColorScheme === "dark" ? (
                    <IconSun size={18} />
                  ) : (
                    <IconMoon size={18} />
                  )}
                </ActionIcon>
              </Tooltip>
            </Group>

            {/* Меню профиля раскрывается ВВЕРХ (top-start) и шириной с триггер —
                не уезжает за правый край узкого дравера на мобиле (right-end
                вылезал за экран и дёргал страницу). */}
            {user ? (
              <Menu position="top-start" withArrow shadow="md" width="target">
                <Menu.Target>
                  <UnstyledButton w="100%" p="xs" style={{ borderRadius: 8 }}>
                    <Group wrap="nowrap">
                      <Avatar radius="xl" size="md" color="brand" variant="filled">
                        {initials(user.name)}
                      </Avatar>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={500} truncate>
                          {user.name}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {user.email}
                        </Text>
                      </div>
                      <IconChevronRight
                        size={16}
                        style={{ color: "var(--mantine-color-dimmed)" }}
                      />
                    </Group>
                  </UnstyledButton>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<IconSettings size={16} />}
                    onClick={() => openSettingsOn("general")}
                  >
                    Настройки
                  </Menu.Item>
                  {user.role === "admin" && (
                    <Menu.Item
                      component="a"
                      href="/admin"
                      leftSection={<IconShieldLock size={16} />}
                    >
                      Админка
                    </Menu.Item>
                  )}
                  <Menu.Divider />
                  <Menu.Item
                    color="red"
                    leftSection={<IconLogout size={16} />}
                    onClick={handleLogout}
                  >
                    Выйти
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            ) : (
              // Незалогинен: настройки скрыты (страница только для авторизованных).
              <Button component="a" href="/login" color="brand" radius="xl" fullWidth>
                Войти
              </Button>
            )}
          </AppShell.Section>
        </AppShell.Navbar>

        {/* Main фиксируем по высоте вьюпорта (100dvh — учитывает адресную строку
            и сжатие под клавиатуру на мобиле, см. viewport.interactiveWidget).
            Внутри — flex-колонка: титл/алерты сверху, окно сообщений тянется и
            скроллится само, поле ввода прижато снизу. Так страница целиком НЕ
            скроллится (титл не уезжает), а при клавиатуре виден верх. */}
        <AppShell.Main style={{ height: "100dvh", minHeight: 0 }}>
          <Box
            maw={900}
            mx="auto"
            h="100%"
            style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
          >
            {children}
          </Box>
        </AppShell.Main>
      </AppShell>
    </>
  );
}
