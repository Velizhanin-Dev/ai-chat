"use client";

import Link from "next/link";
import {
  Stack,
  Group,
  Text,
  Title,
  Paper,
  SimpleGrid,
  Button,
  Badge,
  List,
  ThemeIcon,
  Accordion,
} from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import Section from "./Section";
import SectionHeading from "./SectionHeading";
import Reveal from "./Reveal";

/* ── Тарифы ───────────────────────────────────────────────────────────── */
const PLANS = [
  {
    name: "Пробный",
    price: "0 ₽",
    period: "1 день · без карты",
    features: [
      "18 запросов на пробу",
      "Голос и методика Николая",
      "Без оплаты и привязки карты",
    ],
    cta: "Попробовать бесплатно",
    href: "/chat",
    highlighted: false,
    variant: "default" as const,
  },
  {
    name: "Базовый",
    price: "4 000 ₽",
    period: "в месяц",
    features: [
      "3 контент-плана",
      "30 сценариев",
      "90 шортсов",
      "Все 100+ форматов и длинные видео",
    ],
    cta: "Оформить",
    href: "/chat",
    highlighted: true,
    variant: "filled" as const,
  },
  {
    name: "Максимальный",
    price: "10 000 ₽",
    period: "в месяц",
    features: [
      "Контент-планы без лимита",
      "Сценарии без лимита",
      "Шортсы без лимита",
      "Приоритетная поддержка",
    ],
    cta: "Оформить",
    href: "/chat",
    highlighted: false,
    variant: "default" as const,
  },
];

const FAQ = [
  {
    q: "Это правда отвечает как Велижанин?",
    a: "Да. Модель говорит от первого лица голосом Николая — его интонацией и подходом, а не нейтральным тоном чат-бота. Тон заякорен на реальных образцах его речи.",
  },
  {
    q: "На чём основаны ответы?",
    a: "На базе студии: книге про длинные видео, постах из открытого и закрытого каналов, библиотеке из 100+ форматов и списке антипаттернов. Перед генерацией модель сверяется с эталонами, а не сочиняет «из головы».",
  },
  {
    q: "Заменит ли это продюсера?",
    a: "Это ускоритель, а не замена. Он снимает чистый лист: даёт хук, структуру и черновик по методике. Финальную докрутку и съёмку по-прежнему делаете вы.",
  },
  {
    q: "Подходит для шортсов и рилсов?",
    a: "Да. Для коротких видео есть 100+ эталонных форматов — называете идею, получаете готовую структуру под формат. Для длинных видео работает логика удержания из книги.",
  },
  {
    q: "Кому принадлежат мои идеи и тексты?",
    a: "Всё, что вы создаёте в диалоге, — ваше. Используйте сценарии в своих роликах без ограничений.",
  },
  {
    q: "Как начать?",
    a: "Нажмите «Попробовать», опишите канал и задачу — и получите первый сценарий в том же окне. Регистрация и долгая настройка не нужны.",
  },
];

export default function Pricing() {
  return (
    <>
      <Section id="pricing" alt>
        <Reveal>
          <SectionHeading
            eyebrow="тарифы"
            title="Начните бесплатно — масштабируйтесь по мере роста"
            subtitle="Бесплатный день на пробу. Перейдёте на платный тариф, когда сценарии станут частью рутины."
          />
        </Reveal>

        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg" style={{ alignItems: "stretch" }}>
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delay={i * 90} fill>
              <Paper
                radius="lg"
                p="xl"
                h="100%"
                withBorder
                style={{
                  background: "var(--mantine-color-body)",
                  borderColor: p.highlighted ? "var(--color-accent)" : undefined,
                  borderWidth: p.highlighted ? 2 : 1,
                  boxShadow: p.highlighted
                    ? "0 12px 40px -12px color-mix(in srgb, var(--color-accent) 45%, transparent)"
                    : undefined,
                }}
              >
                <Stack gap="md" h="100%">
                  <Group justify="space-between">
                    <Text fw={600} fz="lg">
                      {p.name}
                    </Text>
                    {p.highlighted && (
                      <Badge color="brand" radius="sm" variant="filled" tt="none">
                        Популярный
                      </Badge>
                    )}
                  </Group>

                  <div>
                    <Text className="lp-display" style={{ fontSize: "2.4rem" }}>
                      {p.price}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {p.period}
                    </Text>
                  </div>

                  <List
                    spacing="xs"
                    icon={
                      <ThemeIcon color="brand" size={20} radius="xl" variant="light">
                        <IconCheck size={12} />
                      </ThemeIcon>
                    }
                  >
                    {p.features.map((f) => (
                      <List.Item key={f}>{f}</List.Item>
                    ))}
                  </List>

                  <Button
                    component={Link}
                    href={p.href}
                    radius="xl"
                    size="md"
                    color="brand"
                    variant={p.variant}
                    mt="auto"
                    fullWidth
                  >
                    {p.cta}
                  </Button>
                </Stack>
              </Paper>
            </Reveal>
          ))}
        </SimpleGrid>
      </Section>

      <Section id="faq">
        <Reveal>
          <SectionHeading eyebrow="вопросы" title="Коротко о главном" />
        </Reveal>
        <Reveal>
          <Accordion variant="separated" radius="md" maw={760} mx="auto">
            {FAQ.map((item) => (
              <Accordion.Item key={item.q} value={item.q}>
                <Accordion.Control>
                  <Text fw={600}>{item.q}</Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <Text c="dimmed" style={{ lineHeight: 1.6 }}>
                    {item.a}
                  </Text>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </Reveal>
      </Section>
    </>
  );
}
