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
  ActionIcon,
  Tooltip,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconSun, IconMoon } from "@tabler/icons-react";
import Logo from "@/components/Brand/Logo";

const LINKS = [
  { href: "#features", label: "Возможности" },
  { href: "#how", label: "Как это работает" },
  { href: "#audiences", label: "Для кого" },
  { href: "#pricing", label: "Тарифы" },
  { href: "#faq", label: "Вопросы" },
];

export default function LandingNav() {
  const [opened, { toggle, close }] = useDisclosure(false);
  const [scrolled, setScrolled] = useState(false);
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: true });
  // Иконку темы рисуем только после маунта. getInitialValueInEffect гасит лишь
  // ветку "auto" (медиазапрос ОС), но если юзер уже переключал тему вручную,
  // схема лежит в localStorage и читается синхронно ("dark") — на сервере же
  // всегда "light". Из-за этого path иконки (солнце/луна) расходился → hydration
  // mismatch. До маунта показываем детерминированную луну (как на сервере).
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
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
              {mounted && computed === "dark" ? (
                <IconSun size={18} />
              ) : (
                <IconMoon size={18} />
              )}
            </ActionIcon>
          </Tooltip>

          <Button
            component={Link}
            href="/login"
            radius="xl"
            color="brand"
            variant="subtle"
            visibleFrom="sm"
          >
            Войти
          </Button>

          <Button
            component={Link}
            href="/register"
            radius="xl"
            color="brand"
            visibleFrom="sm"
          >
            Начать
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
          <Button
            component={Link}
            href="/register"
            radius="xl"
            size="md"
            mt="sm"
            onClick={close}
          >
            Начать
          </Button>
          <Button
            component={Link}
            href="/login"
            radius="xl"
            size="md"
            variant="default"
            onClick={close}
          >
            Войти
          </Button>
        </Stack>
      </Drawer>
    </Box>
  );
}
