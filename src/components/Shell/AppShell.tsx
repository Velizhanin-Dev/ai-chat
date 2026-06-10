"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  AppShell,
  Burger,
  Group,
  NavLink,
  Title,
  ThemeIcon,
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
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconMessageCircle,
  IconBrain,
  IconSun,
  IconMoon,
  IconChevronRight,
  IconLogout,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { loggedOut, PLAN_LABEL } from "@/store/authSlice";

const navItems = [
  {
    href: "/chat",
    label: "Чат",
    icon: <IconMessageCircle size={18} />,
  },
];

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
  const pathname = usePathname();
  const router = useRouter();
  const { setColorScheme } = useMantineColorScheme();
  // getInitialValueInEffect: см. LandingNav — гасит hydration mismatch на иконке
  // переключателя темы (первый клиентский рендер совпадает с серверным "light").
  const computedColorScheme = useComputedColorScheme("light", {
    getInitialValueInEffect: true,
  });
  const user = useAppSelector((s) => s.auth.user);
  const dispatch = useAppDispatch();

  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === "dark" ? "light" : "dark");
  };

  const handleLogout = () => {
    dispatch(loggedOut());
    router.push("/");
  };

  // Лендинг и auth-страницы рендерим без сайдбара/шапки приложения.
  if (BARE_ROUTES.includes(pathname)) {
    return <>{children}</>;
  }

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 260, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
            />
            <Group gap="xs">
              <ThemeIcon size="lg" radius="md" variant="gradient" gradient={{ from: "brand.5", to: "brand.7", deg: 135 }}>
                <IconBrain size={22} />
              </ThemeIcon>
              <Title order={3}>VELIZHANIN AI</Title>
            </Group>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Stack justify="space-between" style={{ flex: 1 }}>
          <div>
            {navItems.map((item) => (
              <NavLink
                key={item.href}
                component={Link}
                href={item.href}
                label={item.label}
                leftSection={item.icon}
                active={pathname === item.href}
                onClick={close}
                variant="filled"
                mb={4}
                style={{ borderRadius: 8 }}
              />
            ))}
          </div>

          <div>
            <Divider mb="sm" />

            <Group justify="space-between" px={4} mb="sm">
              <Text size="xs" c="dimmed">Тема</Text>
              <Tooltip label={computedColorScheme === "dark" ? "Светлая тема" : "Тёмная тема"}>
                <ActionIcon
                  variant="default"
                  size="lg"
                  radius="md"
                  onClick={toggleColorScheme}
                  aria-label="Переключить тему"
                >
                  {computedColorScheme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
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
                  <Menu.Label>Тариф: {PLAN_LABEL[user.plan]}</Menu.Label>
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
              <Button
                component={Link}
                href="/login"
                color="brand"
                radius="xl"
                fullWidth
              >
                Войти
              </Button>
            )}
          </div>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box maw={900} mx="auto">
          {children}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
