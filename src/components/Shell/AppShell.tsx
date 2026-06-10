"use client";

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
import {
  startNewChat,
  setActiveConversation,
  deleteConversation,
} from "@/store/chatSlice";
import Logo from "@/components/Brand/Logo";
import SettingsModal from "@/components/Settings/SettingsModal";

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
  const pathname = usePathname();
  const router = useRouter();
  const { setColorScheme } = useMantineColorScheme();
  // getInitialValueInEffect: см. LandingNav — гасит hydration mismatch на иконке
  // переключателя темы (первый клиентский рендер совпадает с серверным "light").
  const computedColorScheme = useComputedColorScheme("light", {
    getInitialValueInEffect: true,
  });
  const user = useAppSelector((s) => s.auth.user);
  const plan = useAppSelector((s) => s.settings.plan);
  const conversations = useAppSelector((s) => s.chat.conversations);
  const activeId = useAppSelector((s) => s.chat.activeId);
  const dispatch = useAppDispatch();

  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === "dark" ? "light" : "dark");
  };

  const handleLogout = () => {
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
      <SettingsModal opened={settingsOpened} onClose={closeSettings} />
      <AppShell
        header={{ height: 60 }}
        navbar={{ width: 280, breakpoint: "sm", collapsed: { mobile: !opened } }}
        padding="md"
      >
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Group gap="sm">
              <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
              <Logo href="/chat" />
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="sm">
          <AppShell.Section>
            <Button
              fullWidth
              radius="md"
              color="brand"
              leftSection={<IconPlus size={18} />}
              onClick={handleNewChat}
              mb="sm"
            >
              Новый чат
            </Button>
            <Text size="xs" c="dimmed" px={4} mb={4}>
              История диалогов
            </Text>
          </AppShell.Section>

          <AppShell.Section grow component={ScrollArea} type="hover">
            <Stack gap={2}>
              {sorted.length === 0 && (
                <Text size="xs" c="dimmed" ta="center" py="md">
                  Пока нет диалогов
                </Text>
              )}
              {sorted.map((conv) => {
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
                  {computedColorScheme === "dark" ? (
                    <IconSun size={18} />
                  ) : (
                    <IconMoon size={18} />
                  )}
                </ActionIcon>
              </Tooltip>
            </Group>

            {user ? (
              <Menu position="right-end" withArrow shadow="md" width={220}>
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
