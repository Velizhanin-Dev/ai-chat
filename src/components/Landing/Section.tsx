"use client";

import { Box, Container } from "@mantine/core";
import type { ReactNode } from "react";

type SectionProps = {
  id?: string;
  /** Лёгкий тёплый фон для чередования секций (работает и в тёмной теме). */
  alt?: boolean;
  children: ReactNode;
};

/** Единый контейнер секции: ширина 1140, общий вертикальный ритм. */
export default function Section({ id, alt, children }: SectionProps) {
  return (
    <Box
      component="section"
      id={id}
      style={{
        paddingBlock: "clamp(64px, 9vw, 112px)",
        background: alt
          ? "color-mix(in srgb, var(--color-accent) 4%, var(--mantine-color-body))"
          : "var(--mantine-color-body)",
      }}
    >
      <Container size="lg" px="md">
        {children}
      </Container>
    </Box>
  );
}
