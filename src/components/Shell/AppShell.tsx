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
  Badge,
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
  IconTrash,
  IconShieldLock,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { authenticated, loggedOut, PLAN_LABEL } from "@/store/authSlice";
import { apiLogout, apiSaveBrief } from "@/lib/auth-client";
import { readAnonBrief, clearAnonBrief } from "@/lib/anon-brief";
import {
  startNewChat,
  setActiveConversation,
  deleteConversation,
  hydrate,
  resetChat,
} from "@/store/chatSlice";
import {
  apiListConversations,
  apiDeleteConversation,
  migrateLocalConversations,
} from "@/lib/chat-client";
import Logo from "@/components/Brand/Logo";
import SettingsModal from "@/components/Settings/SettingsModal";
import BriefModal from "@/components/Brief/BriefModal";

// Полноэкранные роуты без сайдбара/шапки приложения (как лендинг). /brief —
// анонимная страница брифа по QR-коду, у неё свой layout и нет гейта.
const BARE_ROUTES = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/brief",
];

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
  const [briefOpened, { open: openBrief, close: closeBrief }] =
    useDisclosure(false);
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
  const plan = useAppSelector((s) => s.settings.plan);
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
      const res = await apiListConversations();
      if (res.ok) dispatch(hydrate({ conversations: res.data }));
      else dispatch(resetChat()); // ошибка сети — пустой список, но без залипания
    })();
  }, [authReady, user?.id, dispatch]);

  // Обязательный гейт: залогинен, но бриф не пройден → открываем модалку брифа
  // принудительно (поверх чата, не закрыть, пока не заполнит). На лендинге/auth
  // не трогаем. Закрываем при выходе из аккаунта. НЕ автозакрываем по факту
  // прохождения — после теста показываем экран результата, его закрывает юзер.
  //
  // Перед открытием модалки пробуем подхватить анонимный бриф из localStorage —
  // его мог заполнить пользователь на /brief по QR ещё до регистрации. Если он
  // есть, молча отправляем на бэкенд: briefCompleted станет true и модалка не
  // откроется (повторно проходить не нужно). Пробуем один раз на сессию входа.
  // /admin — собственный layout/shell (см. app/admin); /legal/* — правовые
  // страницы со своим layout. Чат-обвязку на них не навешиваем.
  const onBareRoute =
    BARE_ROUTES.includes(pathname) ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/legal");
  const bridgeTried = useRef(false);
  useEffect(() => {
    if (onBareRoute) return;
    if (!authReady) return;
    if (!user) {
      closeBrief();
      bridgeTried.current = false;
      return;
    }
    if (user.briefCompleted) {
      closeBrief();
      return;
    }
    if (!bridgeTried.current) {
      bridgeTried.current = true;
      const anon = readAnonBrief();
      if (anon) {
        void (async () => {
          const res = await apiSaveBrief(anon);
          if (res.ok) {
            dispatch(authenticated(res.data.user));
            clearAnonBrief();
          } else {
            openBrief();
          }
        })();
        return;
      }
    }
    openBrief();
  }, [authReady, user, onBareRoute, openBrief, closeBrief, dispatch]);

  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === "dark" ? "light" : "dark");
  };

  const handleLogout = async () => {
    await apiLogout(); // гасим серверную cookie
    dispatch(loggedOut());
    router.push("/");
  };

  const handleNewChat = () => {
    // Не создаём диалог сразу — только переводим в пустое состояние.
    dispatch(startNewChat());
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
        onRetakeBrief={() => {
          closeSettings();
          openBrief();
        }}
      />
      <BriefModal
        opened={briefOpened}
        onClose={closeBrief}
        mandatory={!user?.briefCompleted}
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
              <Logo markHref="/" textHref="/chat" />
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="sm">
          <AppShell.Section>
            {/* На десктопе «Новый чат» сверху; на мобиле его прячем и показываем
                крупной CTA внизу дравера (см. нижнюю секцию). */}
            <Button
              fullWidth
              radius="md"
              color="brand"
              leftSection={<IconPlus size={18} />}
              onClick={handleNewChat}
              mb="sm"
              visibleFrom="lg"
            >
              Новый чат
            </Button>
            <Text size="xs" c="dimmed" px={4} mb={4}>
              История диалогов
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
                  Пока нет диалогов
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
                      <Tooltip label="Удалить" openDelay={400}>
                        <ActionIcon
                          component="div"
                          role="button"
                          variant="subtle"
                          color="red"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatch(deleteConversation(conv.id));
                            void apiDeleteConversation(conv.id);
                          }}
                          style={{ flexShrink: 0 }}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </UnstyledButton>
                );
              })}
            </Stack>
          </AppShell.Section>

          <AppShell.Section>
            {/* Мобильная CTA: крупная кнопка «Новый чат» внизу дравера. */}
            <Button
              fullWidth
              size="lg"
              radius="md"
              color="brand"
              leftSection={<IconPlus size={20} />}
              onClick={handleNewChat}
              mb="sm"
              hiddenFrom="lg"
            >
              Новый чат
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
                  <Menu.Label>
                    <Group justify="space-between">
                      <span>Тариф</span>
                      <Badge color="brand" variant="light" size="sm" radius="sm">
                        {PLAN_LABEL[plan]}
                      </Badge>
                    </Group>
                  </Menu.Label>
                  <Menu.Item
                    leftSection={<IconSettings size={16} />}
                    onClick={openSettings}
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
            {/* Пока бриф не пройден — НЕ рендерим чат под модалкой (иначе его видно,
                если снести оверлей через devtools). Сервер всё равно блокирует
                /api/chat без брифа, это лишь чтобы не светить интерфейс. */}
            {authReady && user && !user.briefCompleted ? (
              <Box ta="center" py={80}>
                <Text c="dimmed">
                  Заполни короткое знакомство — и откроется чат. Окно уже открыто
                  поверх страницы.
                </Text>
              </Box>
            ) : (
              children
            )}
          </Box>
        </AppShell.Main>
      </AppShell>
    </>
  );
}
