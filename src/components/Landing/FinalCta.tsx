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
import { LEGAL } from "@/lib/legal";

type FooterCol = {
  title: string;
  titleHref?: string;
  titleExternal?: boolean;
  links: { label: string; href: string; external?: boolean }[];
};

const FOOTER_COLS: FooterCol[] = [
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
      { label: "100+ форматов", href: "#features" },
      { label: "Для кого", href: "#audiences" },
      { label: "Открыть чат", href: "/chat" },
    ],
  },
  {
    title: "VELIZHANIN",
    titleHref: "https://velizhanin.com",
    titleExternal: true,
    links: [
      { label: "content-могущество", href: "https://velizhanin.com", external: true },
      { label: "velizhanin.com", href: "https://velizhanin.com", external: true },
    ],
  },
];

export default function FinalCta({
  hidePricing = false,
  launchMode = false,
}: {
  hidePricing?: boolean;
  launchMode?: boolean;
}) {
  // В pre-launch тарифов нет — убираем ссылку «Тарифы» и из футера.
  const cols = hidePricing
    ? FOOTER_COLS.map((c) => ({ ...c, links: c.links.filter((l) => l.href !== "#pricing") }))
    : FOOTER_COLS;
  return (
    <>
      {/* Финальный CTA-баннер. В режиме «до запуска» его «Попробовать» неактуален —
          скрываем весь баннер (доступ откроется на старте), оставляя футер. */}
      {!launchMode && (
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
                  Собери следующую съёмку вместе с Николаем
                </Title>
                <Text c="white" opacity={0.9} maw={560} size="lg">
                  Опиши канал и задачу — получи рабочий КП и сценарии за минуту.
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
      )}

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
                AI-продюсер по методике Николая Велижанина.
              </Text>
            </Stack>

            {cols.map((col) => (
              <Stack key={col.title} gap="sm">
                {col.titleHref ? (
                  <Anchor
                    component={Link}
                    href={col.titleHref}
                    target={col.titleExternal ? "_blank" : undefined}
                    fw={600}
                    size="sm"
                    c="inherit"
                    underline="never"
                  >
                    {col.title}
                  </Anchor>
                ) : (
                  <Text fw={600} size="sm">
                    {col.title}
                  </Text>
                )}
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

          <Group justify="space-between" mt="xl" gap="md">
            <Text size="xs" c="dimmed">
              © 2026 VELIZHANIN AI · студия «content-могущество»
            </Text>
            <Group gap="md">
              <Anchor component={Link} href="/legal/terms" c="dimmed" size="xs" underline="never">
                Пользовательское соглашение
              </Anchor>
              <Anchor component={Link} href="/legal/privacy" c="dimmed" size="xs" underline="never">
                Политика конфиденциальности
              </Anchor>
            </Group>
          </Group>

          <Text size="xs" c="dimmed" mt="md" style={{ lineHeight: 1.5 }}>
            {LEGAL.operator} · ИНН {LEGAL.inn} · ОГРНИП {LEGAL.ogrnip} · {LEGAL.address} ·{" "}
            тел. {LEGAL.phone} · {LEGAL.email}
          </Text>
        </Container>
      </Box>
    </>
  );
}
