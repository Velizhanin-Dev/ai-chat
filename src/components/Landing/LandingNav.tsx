"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Box,
  Group,
  Burger,
  Drawer,
  Stack,
  Button,
  Text,
  ThemeIcon,
  ActionIcon,
  Tooltip,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconBrain, IconSun, IconMoon } from "@tabler/icons-react";

const LINKS = [
  { href: "#features", label: "Возможности" },
  { href: "#how", label: "Как это работает" },
  { href: "#audiences", label: "Для кого" },
  { href: "#pricing", label: "Тарифы" },
  { href: "#faq", label: "Вопросы" },
];

function Logo() {
  return (
    <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
      <Group gap="xs">
        <ThemeIcon
          size="lg"
          radius="md"
          variant="gradient"
          gradient={{ from: "brand.5", to: "brand.7", deg: 135 }}
        >
          <IconBrain size={22} />
        </ThemeIcon>
        <Text fw={600} fz="lg" style={{ letterSpacing: "-0.02em" }}>
          VELIZHANIN&nbsp;AI
        </Text>
      </Group>
    </Link>
  );
}

export default function LandingNav() {
  const [opened, { toggle, close }] = useDisclosure(false);
  const [scrolled, setScrolled] = useState(false);
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toggleScheme = () =>
    setColorScheme(computed === "dark" ? "light" : "dark");

  return (
    <Box
      component="header"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        backdropFilter: "saturate(180%) blur(12px)",
        background: scrolled
          ? "color-mix(in srgb, var(--mantine-color-body) 82%, transparent)"
          : "transparent",
        borderBottom: scrolled
          ? "1px solid var(--mantine-color-default-border)"
          : "1px solid transparent",
        transition: "background 200ms ease, border-color 200ms ease",
      }}
    >
      <Group
        h={64}
        px="md"
        justify="space-between"
        maw={1140}
        mx="auto"
      >
        <Logo />

        {/* Десктоп-навигация */}
        <Group gap="lg" visibleFrom="sm">
          {LINKS.map((l) => (
            <Text
              key={l.href}
              component="a"
              href={l.href}
              size="sm"
              c="dimmed"
              style={{ textDecoration: "none", cursor: "pointer" }}
            >
              {l.label}
            </Text>
          ))}
        </Group>

        <Group gap="xs">
          <Tooltip label={computed === "dark" ? "Светлая тема" : "Тёмная тема"}>
            <ActionIcon
              variant="default"
              size="lg"
              radius="md"
              onClick={toggleScheme}
              aria-label="Переключить тему"
            >
              {computed === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
          </Tooltip>

          <Button
            component={Link}
            href="/chat"
            radius="xl"
            color="brand"
            visibleFrom="sm"
          >
            Попробовать
          </Button>

          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Меню" />
        </Group>
      </Group>

      {/* Мобильное меню */}
      <Drawer
        opened={opened}
        onClose={close}
        size="80%"
        position="right"
        title={<Logo />}
        hiddenFrom="sm"
        zIndex={200}
      >
        <Stack gap="md">
          {LINKS.map((l) => (
            <Text
              key={l.href}
              component="a"
              href={l.href}
              size="lg"
              fw={500}
              onClick={close}
              style={{ textDecoration: "none" }}
            >
              {l.label}
            </Text>
          ))}
          <Button component={Link} href="/chat" radius="xl" size="md" mt="sm" onClick={close}>
            Попробовать бесплатно
          </Button>
        </Stack>
      </Drawer>
    </Box>
  );
}
