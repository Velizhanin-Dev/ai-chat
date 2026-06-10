"use client";

import { Box, Container } from "@mantine/core";
import type { ReactNode } from "react";

type SectionProps = {
  id?: string;
  /** Тёплый направленный фон (слева направо) для чередования секций. */
  alt?: boolean;
  children: ReactNode;
};

/** Единый контейнер секции: ширина 1140, общий вертикальный ритм. */
export default function Section({ id, alt, children }: SectionProps) {
  return (
    <Box
      component="section"
      id={id}
      className={alt ? "lp-section-alt" : undefined}
      style={{
        paddingBlock: "clamp(64px, 9vw, 112px)",
        background: alt ? undefined : "var(--mantine-color-body)",
      }}
    >
      <Container size="lg" px="md">
        {children}
      </Container>
    </Box>
  );
}
