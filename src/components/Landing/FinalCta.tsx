"use client";

import Link from "next/link";
import {
  Box,
  Container,
  Stack,
  Group,
  Text,
  Title,
  Button,
  ThemeIcon,
  SimpleGrid,
  Anchor,
} from "@mantine/core";
import { IconBrain, IconArrowRight } from "@tabler/icons-react";
import Reveal from "./Reveal";

const FOOTER_COLS = [
  {
    title: "Продукт",
    links: [
      { label: "Возможности", href: "#features" },
      { label: "Как это работает", href: "#how" },
      { label: "Тарифы", href: "#pricing" },
      { label: "Вопросы", href: "#faq" },
    ],
  },
  {
    title: "Методика",
    links: [
      { label: "12 форматов", href: "#features" },
      { label: "Для кого", href: "#audiences" },
      { label: "Открыть чат", href: "/chat" },
    ],
  },
  {
    title: "Студия",
    links: [
      { label: "content-могущество", href: "https://velizhanin.com", external: true },
      { label: "velizhanin.com", href: "https://velizhanin.com", external: true },
    ],
  },
];

export default function FinalCta() {
  return (
    <>
      {/* Финальный CTA-баннер */}
      <Box style={{ paddingBlock: "clamp(48px, 7vw, 80px)", background: "var(--mantine-color-body)" }}>
        <Container size="lg" px="md">
          <Reveal>
            <Box
              style={{
                borderRadius: "var(--radius-xl)",
                padding: "clamp(40px, 6vw, 72px)",
                textAlign: "center",
                background:
                  "linear-gradient(135deg, var(--mantine-color-brand-6), var(--mantine-color-brand-8))",
              }}
            >
              <Stack align="center" gap="lg">
                <Title
                  order={2}
                  className="lp-h2"
                  c="white"
                  style={{ fontSize: "clamp(1.8rem, 4vw, 3rem)", maxWidth: 720 }}
                >
                  Собери следующий сценарий вместе с Николаем
                </Title>
                <Text c="white" opacity={0.9} maw={560} size="lg">
                  Опиши канал и задачу — получи рабочий хук и структуру за минуту.
                  Бесплатно и без регистрации.
                </Text>
                <Button
                  component={Link}
                  href="/chat"
                  size="lg"
                  radius="xl"
                  variant="white"
                  color="dark"
                  rightSection={<IconArrowRight size={18} />}
                >
                  Попробовать бесплатно
                </Button>
              </Stack>
            </Box>
          </Reveal>
        </Container>
      </Box>

      {/* Футер */}
      <Box
        component="footer"
        style={{
          borderTop: "1px solid var(--mantine-color-default-border)",
          paddingBlock: 48,
          background: "var(--mantine-color-body)",
        }}
      >
        <Container size="lg" px="md">
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="xl">
            <Stack gap="xs">
              <Group gap="xs">
                <ThemeIcon
                  size="lg"
                  radius="md"
                  variant="gradient"
                  gradient={{ from: "brand.5", to: "brand.7", deg: 135 }}
                >
                  <IconBrain size={22} />
                </ThemeIcon>
                <Text fw={600} style={{ letterSpacing: "-0.02em" }}>
                  VELIZHANIN AI
                </Text>
              </Group>
              <Text size="sm" c="dimmed" maw={240}>
                AI-сценарист на методике студии «content-могущество».
              </Text>
            </Stack>

            {FOOTER_COLS.map((col) => (
              <Stack key={col.title} gap="sm">
                <Text fw={600} size="sm">
                  {col.title}
                </Text>
                {col.links.map((l) => (
                  <Anchor
                    key={l.label}
                    component={Link}
                    href={l.href}
                    target={"external" in l && l.external ? "_blank" : undefined}
                    c="dimmed"
                    size="sm"
                    underline="never"
                  >
                    {l.label}
                  </Anchor>
                ))}
              </Stack>
            ))}
          </SimpleGrid>

          <Text size="xs" c="dimmed" mt="xl">
            © 2026 VELIZHANIN AI · студия «content-могущество»
          </Text>
        </Container>
      </Box>
    </>
  );
}
