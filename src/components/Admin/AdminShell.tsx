"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AppShell,
  Group,
  Stack,
  Text,
  UnstyledButton,
  Badge,
  Button,
  ThemeIcon,
} from "@mantine/core";
import {
  IconToggleRight,
  IconUsers,
  IconCurrencyRubel,
  IconArrowLeft,
  IconShieldLock,
} from "@tabler/icons-react";
import LogoMark from "@/components/Brand/LogoMark";

// Сайдбар-навигация админки. disabled-пункты — это будущие фазы (юзеры, тарифы):
// показываем структуру, но не ведём на пустые страницы (бейдж «скоро»).
type NavItem = {
  href: string;
  label: string;
  icon: typeof IconToggleRight;
  soon?: boolean;
};

const NAV: NavItem[] = [
  { href: "/admin", label: "Флаги и настройки", icon: IconToggleRight },
  { href: "/admin/users", label: "Пользователи", icon: IconUsers },
  { href: "/admin/plans", label: "Тарифы", icon: IconCurrencyRubel },
];

export default function AdminShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName: string;
}) {
  const pathname = usePathname();

  return (
    <AppShell header={{ height: 60 }} navbar={{ width: 260, breakpoint: "sm" }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <LogoMark box="md" glyph={18} />
            <Text fw={600} fz="lg" style={{ letterSpacing: "-0.02em" }}>
              Админка
            </Text>
            <Badge color="brand" variant="light" radius="sm" size="sm" leftSection={<IconShieldLock size={12} />}>
              {userName}
            </Badge>
          </Group>
          <Button
            component={Link}
            href="/chat"
            variant="subtle"
            color="gray"
            size="sm"
            leftSection={<IconArrowLeft size={16} />}
          >
            В приложение
          </Button>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Stack gap={4}>
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            const inner = (
              <Group gap="sm" wrap="nowrap">
                <ThemeIcon
                  variant={active ? "filled" : "light"}
                  color={active ? "brand" : "gray"}
                  radius="md"
                  size="md"
                >
                  <Icon size={16} />
                </ThemeIcon>
                <Text size="sm" fw={active ? 600 : 400} c={item.soon ? "dimmed" : undefined}>
                  {item.label}
                </Text>
                {item.soon && (
                  <Badge size="xs" variant="light" color="gray" radius="sm" ml="auto">
                    скоро
                  </Badge>
                )}
              </Group>
            );
            if (item.soon) {
              return (
                <div key={item.href} style={{ padding: 8, cursor: "default", opacity: 0.7 }}>
                  {inner}
                </div>
              );
            }
            return (
              <UnstyledButton
                key={item.href}
                component={Link}
                href={item.href}
                p="xs"
                style={{
                  borderRadius: 8,
                  background: active ? "var(--mantine-color-brand-light)" : "transparent",
                }}
              >
                {inner}
              </UnstyledButton>
            );
          })}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>{children}</div>
      </AppShell.Main>
    </AppShell>
  );
}
