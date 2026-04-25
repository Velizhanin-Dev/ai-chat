"use client";

import { usePathname } from "next/navigation";
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
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconMessageCircle,
  IconBrain,
  IconSun,
  IconMoon,
  IconSettings,
} from "@tabler/icons-react";

const navItems = [
  {
    href: "/chat",
    label: "Чат",
    icon: <IconMessageCircle size={18} />,
  },
];

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [opened, { toggle, close }] = useDisclosure();
  const pathname = usePathname();
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");

  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === "dark" ? "light" : "dark");
  };

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
              <ThemeIcon size="lg" radius="md" variant="gradient" gradient={{ from: "blue", to: "teal" }}>
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

            <UnstyledButton
              w="100%"
              p="xs"
              style={{ borderRadius: 8 }}
              onClick={() => {}}
            >
              <Group>
                <Avatar
                  radius="xl"
                  size="md"
                  color="blue"
                  variant="filled"
                >
                  U
                </Avatar>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={500} truncate>Пользователь</Text>
                  <Text size="xs" c="dimmed" truncate>user@example.com</Text>
                </div>
                <IconSettings size={16} style={{ color: "var(--mantine-color-dimmed)" }} />
              </Group>
            </UnstyledButton>
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
