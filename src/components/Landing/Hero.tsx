"use client";

import Link from "next/link";
import Image from "next/image";
import {
  Box,
  Container,
  Stack,
  Group,
  Button,
  Text,
  Title,
  SimpleGrid,
  Grid,
  Paper,
  ThemeIcon,
  List,
  Divider,
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

// Регалии Николая для карточки автора (правая колонка героя).
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
    text: (
      <>
        Среди клиентов: Михаил Гребенюк, Седа Каспарова, Светлана Наумова
      </>
    ),
  },
  { icon: IconBrandYoutube, text: <>110+ каналов на ежемесячном ведении</> },
];

function FounderCard() {
  return (
    <Paper
      radius="lg"
      withBorder
      shadow="md"
      p="xl"
      className="lp-founder-3d"
      style={{ background: "var(--mantine-color-body)" }}
    >
      <Flex
        direction={{ base: "column", md: "row" }}
        align={{ base: "center", md: "flex-start" }}
        gap="lg"
      >
        <Image
          src="/images/photo.jpg"
          alt="Николай Велижанин"
          width={132}
          height={146}
          priority
          style={{
            borderRadius: "var(--radius-lg)",
            objectFit: "cover",
            display: "block",
            boxShadow: "0 10px 30px -14px color-mix(in srgb, var(--color-accent) 60%, transparent)",
          }}
        />
        <Stack
          gap={6}
          ta={{ base: "center", md: "left" }}
          style={{ flex: 1, minWidth: 220, alignSelf: "stretch" }}
        >
          <Text className="lp-h2" style={{ fontSize: "clamp(1.3rem, 2.2vw, 1.7rem)" }}>
            Николай Велижанин
          </Text>
          <Text size="sm" c="dimmed" style={{ lineHeight: 1.5 }}>
            Пионер контент-маркетинга в России с 2016 года, основатель крупнейшей
            в СНГ студии по продвижению бизнеса в YouTube и не только.
          </Text>
        </Stack>
      </Flex>

      <Divider my="lg" />

      <List
        spacing="sm"
        center
        icon={
          <ThemeIcon color="brand" size={26} radius="xl" variant="light">
            <IconBook2 size={15} />
          </ThemeIcon>
        }
      >
        {CREDENTIALS.map((c, i) => (
          <List.Item
            key={i}
            icon={
              <ThemeIcon color="brand" size={26} radius="xl" variant="light">
                <c.icon size={15} />
              </ThemeIcon>
            }
          >
            <Text size="sm" style={{ lineHeight: 1.45 }}>
              {c.text}
            </Text>
          </List.Item>
        ))}
      </List>
    </Paper>
  );
}

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
        {/* Первый экран: слева оффер + CTA, справа карточка автора с регалиями.
            Рендерим сразу, без scroll-reveal, чтобы было видно мгновенно. */}
        <Grid gutter={{ base: "xl", md: 48 }} align="center">
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Stack align="flex-start" gap="lg" ta="left">
              <Title
                order={1}
                className="lp-display"
                style={{ fontSize: "clamp(2.2rem, 5vw, 3.8rem)" }}
              >
                Контент-маркетинг никогда ещё не был так прост
              </Title>

              <Text size="xl" c="dimmed" maw={520} style={{ lineHeight: 1.5 }}>
                Контент-план, сценарии, шаблоны, сценарии длинных видео и рилсов
                от Николая Велижанина.
              </Text>

              <Flex
                gap="sm"
                mt="xs"
                w="100%"
                wrap="wrap"
                justify={{ base: "center", md: "flex-start" }}
              >
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
              </Flex>
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6 }}>
            <FounderCard />
          </Grid.Col>
        </Grid>

        <Box maw={760} mx="auto" mt={64}>
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
