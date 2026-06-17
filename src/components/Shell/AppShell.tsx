"use client";

import { useEffect, useState } from "react";
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
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { loggedOut, PLAN_LABEL } from "@/store/authSlice";
import { apiLogout } from "@/lib/auth-client";
import {
  startNewChat,
  setActiveConversation,
  deleteConversation,
} from "@/store/chatSlice";
import Logo from "@/components/Brand/Logo";
import SettingsModal from "@/components/Settings/SettingsModal";
import BriefModal from "@/components/Brief/BriefModal";

// Полноэкранные роуты без сайдбара/шапки приложения (как лендинг).
const BARE_ROUTES = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
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

  // Обязательный гейт: залогинен, но бриф не пройден → открываем модалку брифа
  // принудительно (поверх чата, не закрыть, пока не заполнит). На лендинге/auth
  // не трогаем. Закрываем при выходе из аккаунта. НЕ автозакрываем по факту
  // прохождения — после теста показываем экран результата, его закрывает юзер.
  const onBareRoute = BARE_ROUTES.includes(pathname);
  useEffect(() => {
    if (onBareRoute) return;
    if (authReady && user && !user.briefCompleted) {
      openBrief();
    } else if (!user) {
      closeBrief();
    }
  }, [authReady, user, onBareRoute, openBrief, closeBrief]);

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

  // Лендинг и auth-страницы рендерим без сайдбара/шапки приложения.
  if (BARE_ROUTES.includes(pathname)) {
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
        navbar={{ width: 280, breakpoint: "sm", collapsed: { mobile: !opened } }}
        padding="md"
      >
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Group gap="sm">
              <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
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
              visibleFrom="sm"
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
              hiddenFrom="sm"
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

        <AppShell.Main>
          <Box maw={900} mx="auto">
            {children}
          </Box>
        </AppShell.Main>
      </AppShell>
    </>
  );
}
