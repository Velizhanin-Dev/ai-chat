"use client";

import Link from "next/link";
import {
  Box,
  Container,
  Stack,
  Group,
  Button,
  Text,
  Title,
  SimpleGrid,
} from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import ChatMockup from "./ChatMockup";

/*
 * ВНИМАНИЕ: цифры ниже — ПЛЕЙСХОЛДЕРЫ. Замените на реальные показатели студии
 * перед публикацией (см. антипаттерн №9 — не выдумывать конкретику).
 * «12 форматов» — единственная фактическая цифра (knowledge-base-formats).
 */
const STATS: { value: string; label: string; real?: boolean }[] = [
  { value: "150М+", label: "просмотров на каналах студии" },
  { value: "300+", label: "каналов в продюсировании" },
  { value: "12", label: "эталонных форматов", real: true },
  { value: "8 лет", label: "в производстве контента" },
];

export default function Hero() {
  return (
    <Box
      className="lp-hero-bg"
      style={{
        paddingTop: "clamp(48px, 8vw, 96px)",
        paddingBottom: "clamp(48px, 7vw, 88px)",
      }}
    >
      <Container size="lg" px="md">
        {/* Контент первого экрана рендерим сразу, без scroll-reveal,
            чтобы он был виден мгновенно и без JS. */}
        <Stack align="center" gap="lg" ta="center">
            <Title
              order={1}
              className="lp-display"
              style={{ fontSize: "clamp(2.4rem, 6.2vw, 4.6rem)", maxWidth: 900 }}
            >
              Сценарии, которые удерживают до конца
            </Title>

            <Text size="xl" c="dimmed" maw={560} style={{ lineHeight: 1.5 }}>
              Хуки и сценарии голосом Николая Велижанина. Продюсерская методика —
              прямо в чате.
            </Text>

            <Group justify="center" gap="sm" mt="xs">
              <Button
                component={Link}
                href="/chat"
                size="lg"
                radius="xl"
                color="brand"
                rightSection={<IconArrowRight size={18} />}
              >
                Попробовать бесплатно
              </Button>
              <Button
                component="a"
                href="#how"
                size="lg"
                radius="xl"
                variant="default"
              >
                Как это работает
              </Button>
            </Group>
        </Stack>

        <Box maw={760} mx="auto" mt={56}>
          <ChatMockup typing />
        </Box>

        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xl" mt={64}>
          {STATS.map((s) => (
            <Stack key={s.label} gap={2} align="center" ta="center">
              <Text
                className="lp-display"
                style={{
                  fontSize: "clamp(2rem, 4vw, 2.8rem)",
                  color: "var(--color-accent)",
                }}
              >
                {s.value}
              </Text>
              <Text size="sm" c="dimmed">
                {s.label}
              </Text>
            </Stack>
          ))}
        </SimpleGrid>
      </Container>
    </Box>
  );
}
