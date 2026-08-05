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
  Burger,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconLayoutDashboard,
  IconToggleRight,
  IconUsers,
  IconCurrencyRubel,
  IconReceipt,
  IconArrowLeft,
  IconShieldLock,
  IconHeadset,
} from "@tabler/icons-react";
import LogoMark from "@/components/Brand/LogoMark";

type NavItem = {
  href: string;
  label: string;
  icon: typeof IconToggleRight;
  soon?: boolean;
};

// Главная админки — дашборд; далее пользователи, поддержка, платежи, тарифы, флаги.
const NAV: NavItem[] = [
  { href: "/admin", label: "Дашборд", icon: IconLayoutDashboard },
  { href: "/admin/users", label: "Пользователи", icon: IconUsers },
  { href: "/admin/support", label: "Поддержка", icon: IconHeadset },
  { href: "/admin/payments", label: "Платежи", icon: IconReceipt },
  { href: "/admin/plans", label: "Тарифы", icon: IconCurrencyRubel },
  { href: "/admin/flags", label: "Флаги и настройки", icon: IconToggleRight },
];

export default function AdminShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName: string;
}) {
  const pathname = usePathname();
  // На мобиле сайдбар — оверлей, по умолчанию свёрнут; бургер в шапке открывает,
  // тап по пункту — закрывает (иначе меню перекрывает контент). На десктопе виден всегда.
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false);

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 260, breakpoint: "sm", collapsed: { mobile: !mobileOpened } }}
      padding="lg"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" aria-label="Меню" />
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
            href="/app"
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
                onClick={closeMobile}
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
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>{children}</div>
      </AppShell.Main>
    </AppShell>
  );
}
