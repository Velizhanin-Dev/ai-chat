"use client";

import Link from "next/link";
import {
  Box,
  Stack,
  Group,
  Title,
  Text,
  ThemeIcon,
  Anchor,
} from "@mantine/core";
import { IconCheck, IconArrowLeft } from "@tabler/icons-react";
import BrandMark from "./BrandMark";

// Качественные тезисы продукта (без выдуманных цифр — см. антипаттерн «не
// выдумывать конкретику»). Это факты о самом продукте.
const POINTS = [
  "100+ эталонных форматов коротких видео",
  "Сценарии длинных видео с логикой удержания",
  "Хуки, превью, названия и CTA по методике",
  "Без выдуманных фактов — только по базе студии",
];

export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Box style={{ minHeight: "100dvh", display: "flex" }}>
      {/* Левая брендовая панель — только на десктопе */}
      <Box
        visibleFrom="md"
        style={{
          flex: "1 1 0",
          background:
            "linear-gradient(150deg, var(--mantine-color-brand-6), var(--mantine-color-brand-8))",
          color: "#fff",
          padding: "48px 56px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <BrandMark light />

        <Stack gap="xl" my="auto" maw={460}>
          <Title
            order={1}
            className="lp-display"
            style={{ color: "#fff", fontSize: "2.6rem" }}
          >
            Контент голосом Николая Велижанина
          </Title>
          <Stack gap="sm">
            {POINTS.map((p) => (
              <Group key={p} gap="sm" wrap="nowrap" align="flex-start">
                <ThemeIcon
                  variant="white"
                  color="brand"
                  radius="xl"
                  size={22}
                  style={{ flexShrink: 0 }}
                >
                  <IconCheck size={13} />
                </ThemeIcon>
                <Text style={{ color: "rgba(255,255,255,0.92)" }}>{p}</Text>
              </Group>
            ))}
          </Stack>
        </Stack>

        <Text size="sm" style={{ color: "rgba(255,255,255,0.7)" }}>
          © VELIZHANIN AI
        </Text>
      </Box>

      {/* Правая область с формой */}
      <Box
        style={{
          flex: "1 1 0",
          display: "flex",
          flexDirection: "column",
          background: "var(--mantine-color-body)",
        }}
      >
        <Group justify="space-between" p="md">
          {/* На мобиле слева брендовой панели нет — показываем лого здесь */}
          <Box hiddenFrom="md">
            <BrandMark size="sm" />
          </Box>
          <Anchor
            component={Link}
            href="/"
            c="dimmed"
            size="sm"
            ml="auto"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <IconArrowLeft size={15} />
            На сайт
          </Anchor>
        </Group>

        <Box
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            padding: "24px 20px 48px",
          }}
        >
          <Stack gap="xl" w="100%" maw={400}>
            <div>
              <Title order={2} className="lp-h2" style={{ fontSize: "1.9rem" }}>
                {title}
              </Title>
              {subtitle && (
                <Text c="dimmed" mt={6}>
                  {subtitle}
                </Text>
              )}
            </div>

            {children}

            {footer}
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
