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
          title="Посмотри, как он отвечает"
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

/* ── Отзывы (реальные — от участников и клиентов студии) ───────────────── */
type Testimonial = {
  name: string;
  role: string;
  quote: string;
  pros: string[];
  cons: string[];
};

const TESTIMONIALS: Testimonial[] = [
  {
    name: "Анастасия",
    role: "YouTube-продюсер",
    quote: "Выдаёт такие темы, о которых я даже не задумывалась.",
    pros: [
      "Перед задачей подробно расспросила о проекте — не «расскажи, чем занимаешься», а целый опрос про боли, цели, портрет аудитории и продукт. По моим ответам сразу поняла архетип клиента — дальше нейросеть точно понимает, что мне нужно, и выдаёт темы, о которых я даже не задумывалась.",
      "Не просто выдаёт темы, а объясняет свою позицию — почему это может сработать.",
      "Получила разные техники, а не только «топ-списки» и «лучшее/худшее» — максимально разносторонний контент-план.",
    ],
    cons: [
      "Может допускать смысловые ошибки: в нише финансов предложила shorts «Почему в России сейчас копить бессмысленно?» — и я не сразу поняла, что имелось в виду. Но это единственная ошибка на 8 выпусков и 16 shorts, и это с первой итерации — попросить переделать одну тему совсем не проблема.",
    ],
  },
  {
    name: "Дмитрий",
    role: "участник КМК",
    quote: "Молодцы — отлично поработали!",
    pros: [
      "Через три итерации получилось добротно — процентов 5–10 подрихтовать под себя, и можно прям сниматься. После первого варианта попросил сменить фокус, после второго — стандартный промпт для Клода: «оцени по 10-балльной и сделай мощнее».",
    ],
    cons: [],
  },
];

function Testimonials() {
  return (
    <Section>
      <Reveal>
        <SectionHeading eyebrow="отзывы" title="Что говорят те, кто уже снимает" />
      </Reveal>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {TESTIMONIALS.map((t, i) => (
          <Reveal key={t.name} delay={i * 90} fill>
            <Paper radius="lg" withBorder p="xl" h="100%" style={{ background: "var(--mantine-color-body)" }}>
              <Stack gap="md" h="100%">
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon size={36} radius="md" color="brand" variant="light">
                    <IconQuote size={18} />
                  </ThemeIcon>
                  <div>
                    <Text fw={600} size="sm">
                      {t.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t.role}
                    </Text>
                  </div>
                </Group>

                <Text fw={600} style={{ lineHeight: 1.45 }}>
                  «{t.quote}»
                </Text>

                <div>
                  <Text fw={600} size="xs" tt="uppercase" c="dimmed" mb={6} style={{ letterSpacing: "0.04em" }}>
                    Плюсы
                  </Text>
                  <Stack gap="xs">
                    {t.pros.map((p, j) => (
                      <Text key={j} size="sm" style={{ lineHeight: 1.55 }}>
                        {p}
                      </Text>
                    ))}
                  </Stack>
                </div>

                <div>
                  <Text fw={600} size="xs" tt="uppercase" c="dimmed" mb={6} style={{ letterSpacing: "0.04em" }}>
                    Минусы
                  </Text>
                  {t.cons.length > 0 ? (
                    <Stack gap="xs">
                      {t.cons.map((c, j) => (
                        <Text key={j} size="sm" style={{ lineHeight: 1.55 }}>
                          {c}
                        </Text>
                      ))}
                    </Stack>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Минусов не отметил.
                    </Text>
                  )}
                </div>
              </Stack>
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
