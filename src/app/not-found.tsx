import Link from "next/link";
import { Box, Group, Stack, Title, Text, Button } from "@mantine/core";
import { IconHome, IconMessageCircle } from "@tabler/icons-react";
import Logo from "@/components/Brand/Logo";

// Брендовая 404. Рендерится «голой» (не /chat → AppShell отдаёт только children).
export default function NotFound() {
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
            404
          </Text>
          <Title order={2} className="lp-h2">
            Такой страницы нет
          </Title>
          <Text c="dimmed" mb="sm">
            Похоже, кадр выпал из монтажа — ссылка устарела или адрес неверный.
            Вернёмся к делу?
          </Text>
          <Group justify="center" gap="sm">
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
              color="brand"
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
