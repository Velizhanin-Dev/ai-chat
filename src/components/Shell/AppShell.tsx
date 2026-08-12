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
  Badge,
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
  IconHelpCircle,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { loggedOut } from "@/store/authSlice";
import { apiLogout } from "@/lib/auth-client";
import { apiSupportUnread } from "@/lib/support-client";
import { readIntendedPlan, clearIntendedPlan } from "@/lib/intended-plan";
import { useChatAccess } from "@/hooks/useChatAccess";
import { startBriefing, hydrate, resetChat } from "@/store/chatSlice";
import {
  apiListConversations,
  migrateLocalConversations,
} from "@/lib/chat-client";
import Logo from "@/components/Brand/Logo";
import RequestsRing from "@/components/Chat/RequestsRing";
import SettingsModal from "@/components/Settings/SettingsModal";
import TopNav from "@/components/Shell/TopNav";
import TelegramSupportButton from "@/components/Support/TelegramSupportButton";
import {
  ProjectHeaderProvider,
  ProjectHeaderTitle,
  ProjectHeaderActions,
} from "@/components/Shell/ProjectHeaderTitle";

// Обвязка приложения показывается на экране без проекта (/app) и на страницах
// проекта (/{projectId}/chat|channel|creatives|thumbnails|settings). Всё остальное
// (лендинг, auth, /admin, /legal, /brief, /payment, 404/500) — «голое».
const PROJECT_TAB_RE =
  /^\/[^/]+\/(chat|channel|creatives|content-plan|competitors|thumbnails|settings)(\/|$)/;

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
      } else {
        // Не достучались даже с ретраями — снимаем скелетон (не вечный лоадер) и
        // разрешаем повторную загрузку при следующем триггере эффекта (смена юзера).
        dispatch(resetChat());
        loadedForUser.current = null;
      }
    })();
  }, [authReady, user?.id, dispatch]);

  // Намерение оформить тариф с лендинга («Оформить» → приложение): один раз
  // открываем настройки на вкладке «Биллинг» и чистим флаг (повторно не всплывёт).
  // Зависим и от pathname: AppShell живёт в layout и НЕ размонтируется при
  // переходе лендинг → приложение, поэтому ловим флаг на смене маршрута.
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
      // закончилась» (chat-страница), второе окно не открываем. Активному — биллинг.
      if (!access.locked) openSettingsOn("billing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, pathname, access.ready, access.locked]);

  // Обвязку (шапка/сайдбар/TopNav) навешиваем на /app, /support и страницы
  // проекта; всё остальное рендерится «голым», своим layout.
  const supportActive = pathname === "/support";
  const onBareRoute = !(
    pathname === "/app" ||
    supportActive ||
    PROJECT_TAB_RE.test(pathname)
  );

  // ── Непрочитанные ответы поддержки (бейдж на кнопке в сайдбаре) ────────────
  // Дешёвый count (индекс (role, readAt)) с поллингом раз в 30 секунд — чтобы
  // ответ поддержки замечался быстро. На странице /support счётчик гасим сразу:
  // её открытие помечает ответы прочитанными на сервере.
  const [supportUnread, setSupportUnread] = useState(0);
  useEffect(() => {
    if (!user) {
      setSupportUnread(0);
      return;
    }
    if (supportActive) {
      setSupportUnread(0);
      return;
    }
    let alive = true;
    const tick = () =>
      void apiSupportUnread().then((n) => {
        if (alive) setSupportUnread(n);
      });
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [user?.id, supportActive]);

  // Разделы-дашборды («Аналитика», «Контент-план») — во всю ширину области, без
  // центрированной колонки maw 900, которая нужна чату/настройкам для читаемости.
  // Канбан-доске и графикам узкая колонка ломает раскладку. Остальные — в колонке.
  const wideRoute = /^\/[^/]+\/(channel|content-plan|competitors)(?:\/|$)/.test(pathname);

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
    // Проект создаётся после прохождения брифа на /app — входим в режим брифа.
    dispatch(startBriefing());
    router.push("/app");
    close();
  };

  const handleSelect = (id: string) => {
    // Открываем проект сменой URL; activeId синхронит ProjectLayout.
    router.push(`/${id}/chat`);
    close();
  };

  const handleSupport = () => {
    router.push("/support");
    close();
  };

  // Лендинг, auth-страницы и админка рендерятся без обвязки приложения.
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
        // padding=0: отступы контента задаём вручную во внутренней обёртке, чтобы
        // TopNav был полосой во всю ширину области (edge-to-edge), а не в колонке.
        padding={0}
      >
        <AppShell.Header>
          {/* На мобиле/планшете (< lg) в шапке тесно: оставляем только знак
              логотипа, а вместо «VELIZHANIN AI» — название текущего проекта.
              Действия над проектом (переименовать/удалить) — справа, рядом с
              кружком квоты. Отдельной строки-заголовка на странице проекта
              больше нет (дублировала название и съедала высоту). */}
          <ProjectHeaderProvider>
            <Group h="100%" px="md" justify="space-between" wrap="nowrap" gap="sm">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                <Burger opened={opened} onClick={toggle} hiddenFrom="lg" size="sm" />
                <Box hiddenFrom="lg" style={{ flexShrink: 0, display: "flex" }}>
                  <Logo href="/" iconOnly />
                </Box>
                <Box visibleFrom="lg" style={{ flexShrink: 0 }}>
                  <Logo href="/" />
                </Box>
                <ProjectHeaderTitle />
              </Group>
              <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                <ProjectHeaderActions />
                {/* Кружок остатка квоты запросов (как в Claude Code). */}
                <RequestsRing />
              </Group>
            </Group>
          </ProjectHeaderProvider>
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
              {/* До гидратации из БД показываем скелетоны, а не ложное «пусто». */}
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
                      // Крупнее на мобиле/iPad (дравер, < lg), компактно на десктопе.
                      p={{ base: "sm", lg: "xs" }}
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
                          fz={{ base: "md", lg: "sm" }}
                          truncate
                          style={{ flex: 1 }}
                          c={active ? undefined : "dimmed"}
                          fw={active ? 500 : 400}
                        >
                          {conv.title}
                        </Text>
                        {/* Удаление/переименование проекта — в шапке самого
                            проекта (chat-страница), не в списке. */}
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

            {/* Техподдержка — отдельная страница /support, только залогиненным
                (у гостя нет треда). Бейдж — непрочитанные ответы поддержки. */}
            {user && (
              <>
              <UnstyledButton
                onClick={handleSupport}
                w="100%"
                p="xs"
                mb="sm"
                style={{
                  borderRadius: 8,
                  background: supportActive
                    ? "var(--mantine-color-brand-light)"
                    : "transparent",
                }}
              >
                <Group gap="xs" wrap="nowrap">
                  <IconHelpCircle
                    size={18}
                    style={{
                      flexShrink: 0,
                      color: supportActive
                        ? "var(--mantine-color-brand-filled)"
                        : "var(--mantine-color-dimmed)",
                    }}
                  />
                  <Text
                    size="sm"
                    style={{ flex: 1, minWidth: 0 }}
                    truncate
                    fw={supportActive ? 500 : 400}
                    c={supportActive ? undefined : "dimmed"}
                  >
                    Нужна помощь? Напишите нам
                  </Text>
                  {supportUnread > 0 && (
                    <Badge size="sm" circle color="brand" style={{ flexShrink: 0 }}>
                      {supportUnread}
                    </Badge>
                  )}
                </Group>
              </UnstyledButton>

              {/* Вторая дверь в ту же поддержку: многим быстрее написать в
                  телеграм, чем открывать раздел. Тред общий — ответ придёт и
                  сюда, и в личку бота. */}
              <Box mt={6} mb="sm">
                <TelegramSupportButton size="xs" fullWidth variant="subtle" />
              </Box>
              </>
            )}

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
                не уезжает за правый край узкого дравера на мобиле. */}
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
            Внутри — flex-колонка: TopNav сверху, затем контент страницы. */}
        <AppShell.Main
          style={{
            height: "100dvh",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Десктоп (≥ lg): меню — полоса во всю ширину области сверху. */}
          <Box visibleFrom="lg">
            <TopNav />
          </Box>
          {/* Отступы контента (бывший padding AppShell) — здесь. Внутри —
              центрированная колонка maw 900. */}
          <Box
            p={{ base: "xs", sm: "md" }}
            style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
          >
            <Box
              maw={wideRoute ? undefined : 900}
              mx="auto"
              w="100%"
              style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
            >
              {/* Мобайл/iPad (< lg): меню внутри колонки — сосед заголовка, тянем
                  «в край» (topnav-bleed). Заголовок проекта на чат-странице
                  поднимается НАД меню через flex order (см. chat-страницу). На /app
                  TopNav вернёт null. */}
              <Box hiddenFrom="lg" className="topnav-bleed">
                <TopNav />
              </Box>
              {children}
            </Box>
          </Box>
        </AppShell.Main>
      </AppShell>
    </>
  );
}
