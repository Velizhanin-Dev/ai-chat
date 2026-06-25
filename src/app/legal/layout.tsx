import { Box, Container, Group, Anchor, Text } from "@mantine/core";
import LogoMark from "@/components/Brand/LogoMark";
import LegalBreadcrumbs from "@/components/Legal/LegalBreadcrumbs";
import { LEGAL } from "@/lib/legal";

// Свой layout для правовых страниц (/legal/*): лёгкая шапка с брендом (ведёт на
// главную) и футер с перекрёстными ссылками. Без чат-обвязки (см. AppShell:
// /legal в bare-ветке).
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <Box
        component="header"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Group h={64} px="md" maw={960} mx="auto">
          <Anchor href="/" underline="never" c="inherit">
            <Group gap="xs" wrap="nowrap">
              <LogoMark box="md" glyph={18} />
              <Text fw={600} fz="lg" style={{ letterSpacing: "-0.02em" }}>
                {LEGAL.brand}
              </Text>
            </Group>
          </Anchor>
        </Group>
      </Box>

      <Container size="md" px="md" py={{ base: "xl", sm: 48 }} style={{ flex: 1, width: "100%" }}>
        <LegalBreadcrumbs />
        {children}
      </Container>

      <Box
        component="footer"
        style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
      >
        <Group h="auto" px="md" py="lg" maw={960} mx="auto" justify="space-between" gap="md">
          <Text size="xs" c="dimmed">
            © 2026 {LEGAL.brand}
          </Text>
          <Group gap="md">
            <Anchor href="/legal/terms" size="xs" c="dimmed" underline="never">
              Пользовательское соглашение
            </Anchor>
            <Anchor href="/legal/privacy" size="xs" c="dimmed" underline="never">
              Политика конфиденциальности
            </Anchor>
          </Group>
        </Group>
      </Box>
    </Box>
  );
}
