"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Box, Group, Stack, Title, Text, Button } from "@mantine/core";
import { IconHome, IconMessageCircle, IconRefresh } from "@tabler/icons-react";
import Logo from "@/components/Brand/Logo";

// Брендовая 500/ошибка сегмента. Next требует client-компонент с {error, reset}.
// Рендерится «голой» (не /chat → AppShell отдаёт только children).
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error]", error);
  }, [error]);

  return (
    <Box
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--mantine-color-body)",
      }}
    >
      <Group p="md">
        <Logo href="/" />
      </Group>

      <Box
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 16px max(40px, env(safe-area-inset-bottom))",
        }}
      >
        <Stack align="center" gap="sm" maw={460} ta="center">
          <Text
            className="lp-display"
            style={{ fontSize: "clamp(4rem, 18vw, 7.5rem)", color: "var(--color-accent)", lineHeight: 1 }}
          >
            500
          </Text>
          <Title order={2} className="lp-h2">
            Что-то сломалось
          </Title>
          <Text c="dimmed" mb="sm">
            У нас тут технический дубль. Попробуйте ещё раз — или вернитесь к работе.
          </Text>
          <Group justify="center" gap="sm">
            <Button
              color="brand"
              radius="md"
              leftSection={<IconRefresh size={16} />}
              onClick={reset}
            >
              Попробовать снова
            </Button>
            <Button
              component={Link}
              href="/"
              variant="default"
              radius="md"
              leftSection={<IconHome size={16} />}
            >
              На главную
            </Button>
            <Button
              component={Link}
              href="/chat"
              variant="default"
              radius="md"
              leftSection={<IconMessageCircle size={16} />}
            >
              В чат
            </Button>
          </Group>
        </Stack>
      </Box>
    </Box>
  );
}
