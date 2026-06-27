"use client";

/* eslint-disable @next/next/no-img-element -- одна hero-фотка обычным <img>:
   не тащим next/image-оптимизатор (sharp) в standalone-сборку ради одного фото. */

import Link from "next/link";
import {
  Box,
  Container,
  Stack,
  Button,
  Text,
  Title,
  SimpleGrid,
  Paper,
  ThemeIcon,
  List,
  Flex,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBook2,
  IconAward,
  IconUsers,
  IconBrandYoutube,
} from "@tabler/icons-react";
import ChatMockup from "./ChatMockup";
import LaunchCountdown from "./LaunchCountdown";
import { ymGoal } from "@/lib/metrika";

/*
 * ВНИМАНИЕ: цифры ниже — ПЛЕЙСХОЛДЕРЫ. Замените на реальные показатели студии
 * перед публикацией (см. антипаттерн №9 — не выдумывать конкретику).
 */
const STATS: { value: string; label: string; real?: boolean }[] = [
  { value: "150М+", label: "просмотров на каналах студии" },
  { value: "300+", label: "каналов в продюсировании" },
  { value: "100+", label: "готовых решений по сценариям" },
  { value: "8 лет", label: "в производстве контента" },
];

// Регалии Николая для «речевого облака» рядом с фото.
const CREDENTIALS: { icon: typeof IconBook2; text: React.ReactNode }[] = [
  { icon: IconBook2, text: <>Автор книги «YouTube для вашего бизнеса»</> },
  {
    icon: IconAward,
    text: (
      <>
        <b>7 золотых</b> и <b>47 серебряных</b> кнопок — с нуля, без вложений в
        рекламу
      </>
    ),
  },
  {
    icon: IconUsers,
    text: <>Среди клиентов: Михаил Гребенюк, Седа Каспарова, Светлана Наумова</>,
  },
  { icon: IconBrandYoutube, text: <>110+ каналов на ежемесячном ведении</> },
];

/** Содержимое карточки про Николая — общее для десктопного и мобильного
 *  варианта. Фото заходит ЗА карточку (см. Hero), отдельный отступ не нужен. */
function FounderBubble() {
  return (
    <Paper radius="lg" p="lg" className="hero-speech-bubble">
      <Stack gap={4} mb="sm">
        <Text className="lp-h2" style={{ fontSize: "1.25rem", lineHeight: 1.2 }}>
          Николай Велижанин
        </Text>
        <Text size="sm" c="dimmed" style={{ lineHeight: 1.5 }}>
          Пионер контент-маркетинга в России с 2016 года, основатель крупнейшей
          в СНГ студии по продвижению бизнеса в YouTube и не только.
        </Text>
      </Stack>

      <List
        spacing="xs"
        center
        icon={
          <ThemeIcon color="brand" size={24} radius="xl" variant="light">
            <IconBook2 size={14} />
          </ThemeIcon>
        }
      >
        {CREDENTIALS.map((c, i) => (
          <List.Item
            key={i}
            icon={
              <ThemeIcon color="brand" size={24} radius="xl" variant="light">
                <c.icon size={14} />
              </ThemeIcon>
            }
          >
            <Text size="sm" style={{ lineHeight: 1.4 }}>
              {c.text}
            </Text>
          </List.Item>
        ))}
      </List>
    </Paper>
  );
}

export default function Hero({ launchTarget }: { launchTarget?: string | null }) {
  return (
    <Box
      className="lp-hero-bg"
      style={{
        paddingTop: "clamp(48px, 8vw, 96px)",
        paddingBottom: "clamp(48px, 7vw, 88px)",
      }}
    >
      <Container size="lg" px="md">
        {/* Оффер + CTA. Карточку автора убрали — Николай теперь «живёт» на
            визуале чата ниже (фото + речевое облако). */}
        <Stack align="center" gap="lg" ta="center" maw={900} mx="auto">
          <Title
            order={1}
            className="lp-display"
            style={{ fontSize: "clamp(2.2rem, 5vw, 3.8rem)" }}
          >
            Контент-маркетинг никогда ещё не был так прост
          </Title>

          <Text size="xl" c="dimmed" maw={620} style={{ lineHeight: 1.5 }}>
            Контент-план, сценарии, шаблоны, сценарии длинных видео и рилсов от
            Николая Велижанина
          </Text>

          {/* Pre-launch: вместо обычного оффера показываем анимированный отсчёт. */}
          {launchTarget && (
            <Box w="100%" mt="xs">
              <LaunchCountdown targetAt={launchTarget} />
            </Box>
          )}

          <Flex gap="sm" mt="xs" w="100%" wrap="wrap" justify="center">
            {/* В режиме «до запуска» CTA «Попробовать» не показываем — доступ
                откроется на старте (см. таймер выше). */}
            {!launchTarget && (
              <Button
                component={Link}
                href="/chat"
                size="lg"
                radius="xl"
                color="brand"
                rightSection={<IconArrowRight size={18} />}
                onClick={() => ymGoal("cta_try")}
              >
                Попробовать бесплатно
              </Button>
            )}
            <Button
              component="a"
              href="#how"
              size="lg"
              radius="xl"
              variant="default"
            >
              Как это работает
            </Button>
          </Flex>
        </Stack>

        {/* Визуал: чат на всю ширину; фото пристыковано к ВЕРХНЕМУ краю чата
            (нижним краем уходит ЗА чат — кромка чата срезает обрез PNG), а справа
            от фото — карточка-регалии, «стоящая» на том же чате. */}
        {/* Десктоп: ряд [фото | регалии] стоит на чате; чат перекрывает низ фото. */}
        <Box visibleFrom="md" maw={1060} mx="auto" mt={56}>
          <Flex align="flex-end" gap={36} pos="relative" style={{ zIndex: 0 }}>
            <img
              src="/images/photo-alpha.png"
              alt="Николай Велижанин"
              width={300}
              height={401}
              style={{
                display: "block",
                flexShrink: 0,
                width: 300,
                height: "auto",
                marginBottom: -40,
                filter:
                  "drop-shadow(0 18px 34px color-mix(in srgb, var(--color-accent) 30%, transparent))",
                pointerEvents: "none",
                userSelect: "none",
              }}
            />
            <Box style={{ flex: 1, minWidth: 0 }}>
              <FounderBubble />
            </Box>
          </Flex>

          {/* Чат на всю ширину — zIndex выше, прячет нижний край фото. */}
          <Box pos="relative" style={{ zIndex: 1 }}>
            <ChatMockup typing />
          </Box>
        </Box>

        {/* Мобайл/планшет: фото по центру над чатом (нижний край за чатом),
            регалии — карточкой под чатом. */}
        <Box hiddenFrom="md" mt={48}>
          <Box ta="center">
            <img
              src="/images/photo-alpha.png"
              alt="Николай Велижанин"
              width={208}
              height={278}
              style={{
                position: "relative",
                zIndex: 0,
                display: "inline-block",
                width: 208,
                height: "auto",
                marginBottom: -44,
                filter:
                  "drop-shadow(0 14px 28px color-mix(in srgb, var(--color-accent) 30%, transparent))",
              }}
            />
          </Box>
          <Box pos="relative" style={{ zIndex: 1 }}>
            <ChatMockup typing />
          </Box>
          <Box mt="lg">
            <FounderBubble />
          </Box>
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
