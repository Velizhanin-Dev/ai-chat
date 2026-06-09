"use client";

import { Stack, Text, Title } from "@mantine/core";

type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: "center" | "left";
};

/** Единый заголовок секции: надзаголовок + h2 в фирменном «тесном» стиле. */
export default function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
}: SectionHeadingProps) {
  return (
    <Stack
      gap="xs"
      align={align === "center" ? "center" : "flex-start"}
      ta={align}
      maw={align === "center" ? 680 : undefined}
      mx={align === "center" ? "auto" : undefined}
      mb="xl"
    >
      {eyebrow && (
        <Text
          fw={600}
          size="sm"
          tt="lowercase"
          style={{ color: "var(--color-accent)", letterSpacing: 0 }}
        >
          {eyebrow}
        </Text>
      )}
      <Title
        order={2}
        className="lp-h2"
        style={{ fontSize: "clamp(1.8rem, 3.6vw, 2.8rem)" }}
      >
        {title}
      </Title>
      {subtitle && (
        <Text size="lg" c="dimmed" style={{ lineHeight: 1.5 }}>
          {subtitle}
        </Text>
      )}
    </Stack>
  );
}
