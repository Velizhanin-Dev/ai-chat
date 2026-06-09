"use client";

import {
  Box,
  Grid,
  Stack,
  Group,
  Text,
  Title,
  Paper,
  ThemeIcon,
  Avatar,
  SimpleGrid,
} from "@mantine/core";
import {
  IconBrandYoutube,
  IconMovie,
  IconUsersGroup,
  IconMicrophone,
  IconQuote,
} from "@tabler/icons-react";
import Section from "./Section";
import SectionHeading from "./SectionHeading";
import Reveal from "./Reveal";
import ChatMockup, { type MockMessage } from "./ChatMockup";

/* ── Для кого (бенто) ─────────────────────────────────────────────────── */
const AUDIENCES = [
  {
    icon: IconBrandYoutube,
    title: "YouTube-блогеры",
    text: "Сценарии длинных видео с удержанием, хуки, превью и названия — стабильный поток роликов без выгорания.",
    span: 7,
  },
  {
    icon: IconMovie,
    title: "Продюсеры и сценаристы",
    text: "Быстрый черновик по методике, который остаётся докрутить, а не писать с нуля.",
    span: 5,
  },
  {
    icon: IconUsersGroup,
    title: "Контент-команды и SMM",
    text: "Единый стандарт сценариев на потоке: рилсы, шортсы и длинные форматы в одном тоне.",
    span: 5,
  },
  {
    icon: IconMicrophone,
    title: "Эксперты, которые ведут блог сами",
    text: "Продюсерское мышление под рукой, когда нет своей команды, — от идеи до структуры ролика.",
    span: 7,
  },
];

function Audiences() {
  return (
    <Section id="audiences">
      <Reveal>
        <SectionHeading
          eyebrow="для кого"
          title="Тем, кто живёт контентом"
          subtitle="От соло-блогера до студии: помогает там, где нужно много идей и стабильное качество."
        />
      </Reveal>

      <Grid gutter="lg">
        {AUDIENCES.map((a, i) => (
          <Grid.Col key={a.title} span={{ base: 12, md: a.span }}>
            <Reveal delay={(i % 2) * 90} fill>
              <Paper radius="lg" withBorder p="xl" h="100%" style={{ background: "var(--mantine-color-body)" }}>
                <ThemeIcon size={48} radius="md" color="brand" variant="light" mb="md">
                  <a.icon size={24} />
                </ThemeIcon>
                <Title order={3} fz="xl" mb="xs">
                  {a.title}
                </Title>
                <Text c="dimmed" style={{ lineHeight: 1.55 }}>
                  {a.text}
                </Text>
              </Paper>
            </Reveal>
          </Grid.Col>
        ))}
      </Grid>
    </Section>
  );
}

/* ── Демонстрация голоса ──────────────────────────────────────────────── */
const DEMO: MockMessage[] = [
  {
    role: "user",
    content: "Канал про личные финансы. Нужен заход для шортса про кредитки",
  },
  {
    role: "assistant",
    content:
      "Про кредитки все долбят одно и то же — «не бери, это долговая яма». Скучно, пролистнут. Заходи через парадокс: «Я специально завёл пять кредиток. И за год на этом заработал, а не потерял». Дальше — как, по шагам. Людей цепляет, когда ты делаешь наоборот и не разоряешься. Это формат «ебучий гений» — берём приём оттуда.",
  },
];

function VoiceDemo() {
  return (
    <Section alt>
      <Reveal>
        <SectionHeading
          eyebrow="живой тон"
          title="Послушай, как он отвечает"
          subtitle="Не вежливый шаблон, а разбор по делу — с приёмом из конкретного формата."
        />
      </Reveal>
      <Reveal delay={100}>
        <Box maw={760} mx="auto">
          <ChatMockup messages={DEMO} />
        </Box>
      </Reveal>
    </Section>
  );
}

/* ── Отзывы ───────────────────────────────────────────────────────────── *
 * ПЛЕЙСХОЛДЕРЫ: тексты и имена вымышлены для вёрстки.
 * Замените на реальные отзывы с согласия авторов перед публикацией.            */
const TESTIMONIALS = [
  {
    quote:
      "Перестал залипать над чистым листом. Хук и структура за минуту — дальше только докрутить под себя.",
    name: "[Имя автора]",
    role: "[ниша · канал]",
  },
  {
    quote:
      "Отвечает реально как Николай на разборе — по делу и с характером, без воды «нейросетки».",
    name: "[Имя автора]",
    role: "[ниша · канал]",
  },
  {
    quote:
      "Командой гоним рилсы на потоке. 12 форматов закрывают почти любую идею — качество ровное.",
    name: "[Имя автора]",
    role: "[студия · команда]",
  },
];

function Testimonials() {
  return (
    <Section>
      <Reveal>
        <SectionHeading eyebrow="отзывы" title="Что говорят те, кто уже снимает" />
      </Reveal>
      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
        {TESTIMONIALS.map((t, i) => (
          <Reveal key={i} delay={i * 90} fill>
            <Paper radius="lg" withBorder p="xl" h="100%" style={{ background: "var(--mantine-color-body)" }}>
              <ThemeIcon size={32} radius="md" color="brand" variant="light" mb="md">
                <IconQuote size={18} />
              </ThemeIcon>
              <Text style={{ lineHeight: 1.55 }} mb="lg">
                {t.quote}
              </Text>
              <Group gap="sm">
                <Avatar color="brand" radius="xl" variant="light">
                  {t.name.charAt(1) || "А"}
                </Avatar>
                <div>
                  <Text fw={600} size="sm">
                    {t.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t.role}
                  </Text>
                </div>
              </Group>
            </Paper>
          </Reveal>
        ))}
      </SimpleGrid>
    </Section>
  );
}

export default function Showcase() {
  return (
    <>
      <Audiences />
      <VoiceDemo />
      <Testimonials />
    </>
  );
}
