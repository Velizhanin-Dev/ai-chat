"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Box, Paper, Group, Text, Button, ThemeIcon } from "@mantine/core";
import { IconCookie } from "@tabler/icons-react";

// Страницы, где плашка не нужна (напр. анонимный бриф по QR — отдельный фокусный
// экран, лишний баннер только мешает).
const HIDDEN_ON = ["/brief"];

// Плашка-уведомление об использовании cookie (152-ФЗ). Согласие запоминаем в
// localStorage, поэтому показываем ровно один раз. Никакого скрима — это баннер,
// а не модалка: он не блокирует контент.
const CONSENT_KEY = "creative-chat:cookie-consent-v1";

export default function CookieBanner() {
  const pathname = usePathname();
  // На сервере и до монтирования — ничего (иначе расхождение гидратации:
  // localStorage доступен только в браузере).
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(CONSENT_KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  const accept = () => {
    try {
      localStorage.setItem(CONSENT_KEY, new Date().toISOString());
    } catch {
      /* приватный режим без localStorage — просто скрываем на эту сессию */
    }
    setVisible(false);
  };

  if (HIDDEN_ON.includes(pathname)) return null;
  if (!visible) return null;

  return (
    <Box
      className="cookie-banner"
      role="region"
      aria-label="Уведомление об использовании cookie"
      // pointerEvents:none на обёртке + auto на карточке — клики мимо плашки
      // уходят на страницу под ней (обёртка тянется на всю ширину).
      style={{
        position: "fixed",
        insetInline: 0,
        bottom: 0,
        zIndex: 190, // ниже модалок Mantine (200), выше контента
        padding: "var(--mantine-spacing-md)",
        paddingBottom: "max(var(--mantine-spacing-md), env(safe-area-inset-bottom))",
        pointerEvents: "none",
      }}
    >
      <Paper
        withBorder
        shadow="md"
        radius="md"
        p="md"
        style={{ pointerEvents: "auto", maxWidth: 920, marginInline: "auto" }}
      >
        <Group justify="space-between" wrap="wrap" gap="md">
          <Group gap="sm" wrap="nowrap" style={{ flex: "1 1 320px", minWidth: 0 }}>
            <ThemeIcon size={36} radius="xl" variant="light" color="brand" style={{ flexShrink: 0 }}>
              <IconCookie size={20} />
            </ThemeIcon>
            <Text size="sm" c="dimmed">
              Мы используем cookie, чтобы сайт работал корректно и было удобнее.
              Оставаясь здесь, вы соглашаетесь с их использованием.
            </Text>
          </Group>
          <Button
            color="brand"
            radius="xl"
            size="sm"
            onClick={accept}
            style={{ flexShrink: 0 }}
          >
            Принять
          </Button>
        </Group>
      </Paper>
    </Box>
  );
}
