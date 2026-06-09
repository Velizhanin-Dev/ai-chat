"use client";

import {
  Grid,
  Stack,
  Group,
  Text,
  Title,
  SimpleGrid,
  Paper,
  ThemeIcon,
  Badge,
  List,
  rem,
} from "@mantine/core";
import {
  IconUserHeart,
  IconBook2,
  IconBrandTelegram,
  IconLockAccess,
  IconLayoutGrid,
  IconAlertTriangle,
  IconCheck,
  IconMessage2Bolt,
  IconAdjustments,
  IconRefresh,
} from "@tabler/icons-react";
import Section from "./Section";
import SectionHeading from "./SectionHeading";
import Reveal from "./Reveal";

type FeatureRowProps = {
  reversed?: boolean;
  eyebrow: string;
  title: string;
  text: string;
  bullets?: string[];
  visual: React.ReactNode;
};

function FeatureRow({ reversed, eyebrow, title, text, bullets, visual }: FeatureRowProps) {
  return (
    <Grid gutter="xl" align="center">
      <Grid.Col span={{ base: 12, md: 6 }} order={{ base: 2, md: reversed ? 2 : 1 }}>
        <Stack gap="md">
          <Text fw={600} size="sm" style={{ color: "var(--color-accent)" }}>
            {eyebrow}
          </Text>
          <Title order={3} className="lp-h2" style={{ fontSize: "clamp(1.5rem, 2.6vw, 2.1rem)" }}>
            {title}
          </Title>
          <Text c="dimmed" size="lg" style={{ lineHeight: 1.55 }}>
            {text}
          </Text>
          {bullets && (
            <List
              spacing="xs"
              icon={
                <ThemeIcon color="brand" size={22} radius="xl">
                  <IconCheck size={14} />
                </ThemeIcon>
              }
            >
              {bullets.map((b) => (
                <List.Item key={b}>{b}</List.Item>
              ))}
            </List>
          )}
        </Stack>
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 6 }} order={{ base: 1, md: reversed ? 1 : 2 }}>
        {visual}
      </Grid.Col>
    </Grid>
  );
}

/* ── Визуал 1: фирменная цитата (реальная фраза из базы голоса) ───────── */
function QuoteVisual() {
  return (
    <Paper radius="lg" withBorder p="xl" shadow="md" style={{ background: "var(--mantine-color-body)" }}>
      <Text
        className="lp-h2"
        style={{ fontSize: "clamp(1.4rem, 2.4vw, 1.9rem)" }}
      >
        «Не бывает плохих ниш, бывает только наша ограниченность».
      </Text>
      <Group gap="xs" mt="lg">
        <ThemeIcon size="md" radius="xl" color="brand" variant="light">
          <IconUserHeart size={16} />
        </ThemeIcon>
        <Text size="sm" c="dimmed">
          Николай Велижанин — его голос, его интонация
        </Text>
      </Group>
    </Paper>
  );
}

/* ── Визуал 2: слои базы знаний ───────────────────────────────────────── */
const LAYERS = [
  { icon: IconBook2, title: "Книга", note: "длинные видео: сценарий, удержание, превью" },
  { icon: IconBrandTelegram, title: "Открытый канал", note: "ВИСП, рилсы, актуальные тренды" },
  { icon: IconLockAccess, title: "Закрытый клуб", note: "кейсы и разборы из практики студии" },
  { icon: IconLayoutGrid, title: "12 форматов", note: "эталонные структуры коротких видео" },
  { icon: IconAlertTriangle, title: "Антипаттерны", note: "ошибки, которые он не повторит" },
];

function LayersVisual() {
  return (
    <Stack gap="sm">
      {LAYERS.map((l) => (
        <Paper key={l.title} radius="md" withBorder p="md" style={{ background: "var(--mantine-color-body)" }}>
          <Group gap="md" wrap="nowrap">
            <ThemeIcon size={40} radius="md" color="brand" variant="light">
              <l.icon size={20} />
            </ThemeIcon>
            <div>
              <Text fw={600} size="sm">
                {l.title}
              </Text>
              <Text size="sm" c="dimmed">
                {l.note}
              </Text>
            </div>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

/* ── Визуал 3: 12 форматов (реальные названия из методики) ─────────────── */
const FORMATS = [
  "оценка идей",
  "реакция на новости",
  "глупый вопрос",
  "пересказ фильма",
  "анекдот / притча",
  "история из детства",
  "эксперимент",
  "«ебучий гений»",
  "«в России сейчас…»",
  "худший совет",
  "загадка",
  "статичная табличка",
];

function FormatsVisual() {
  return (
    <Paper radius="lg" withBorder p="xl" style={{ background: "var(--mantine-color-body)" }}>
      <Group gap="xs">
        {FORMATS.map((f) => (
          <Badge key={f} size="lg" radius="sm" variant="light" color="brand" tt="none" fw={500}>
            {f}
          </Badge>
        ))}
      </Group>
    </Paper>
  );
}

/* ── Как это работает ─────────────────────────────────────────────────── */
const STEPS = [
  {
    icon: IconMessage2Bolt,
    title: "Расскажи о задаче",
    text: "Ниша, формат (длинное видео или шортс), тема и канал — пары фраз достаточно.",
  },
  {
    icon: IconAdjustments,
    title: "Получи сценарий по методике",
    text: "Хук, удержание, структура блоков и CTA — собранные по эталонам студии, голосом Николая.",
  },
  {
    icon: IconRefresh,
    title: "Доведи до съёмки в диалоге",
    text: "Уточняй, проси варианты хука и названия, докручивай до версии, которую не стыдно снимать.",
  },
];

export default function Features() {
  return (
    <>
      <Section id="features" alt>
        <Reveal>
          <SectionHeading
            eyebrow="возможности"
            title="Не очередной чат-бот, а продюсер в кармане"
            subtitle="Три причины, почему сценарии получаются рабочими, а не «обобщённым ИИ-бредом»."
          />
        </Reveal>

        <Stack gap={88}>
          <Reveal>
            <FeatureRow
              eyebrow="Голос"
              title="Это Николай — от первого лица"
              text="Никаких «как AI-ассистент, я могу предложить…». Отвечает своим живым языком, с характером и личной оценкой — так, будто продюсер сел рядом и разобрал твой ролик."
              bullets={["Живая разговорная речь, а не канцелярит", "Личная оценка: «залетит» / «душнина»", "Без воды и извиняющихся преамбул"]}
              visual={<QuoteVisual />}
            />
          </Reveal>

          <Reveal>
            <FeatureRow
              reversed
              eyebrow="Опора на факты"
              title="Не выдумывает — стоит на базе студии"
              text="Перед каждым хуком, заголовком и CTA сверяется с реальными эталонами: книгой, постами из каналов и библиотекой форматов. Если ответа в базе нет — честно скажет, а не сочинит."
              bullets={["Каждый блок — из проверенной практики", "Не придумывает цифры, фильмы и кейсы", "5 слоёв знаний под капотом"]}
              visual={<LayersVisual />}
            />
          </Reveal>

          <Reveal>
            <FeatureRow
              eyebrow="Любой формат"
              title="Сценарий под формат, а не «универсальный»"
              text="Длинные видео 10+ минут и короткие рилсы/шортсы — со своей логикой. Для коротких есть 12 эталонных форматов: называешь идею — получаешь готовую структуру."
              visual={<FormatsVisual />}
            />
          </Reveal>
        </Stack>
      </Section>

      <Section id="how">
        <Reveal>
          <SectionHeading
            eyebrow="как это работает"
            title="От идеи до сценария — за один разговор"
          />
        </Reveal>

        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="xl">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 90} fill>
              <Paper radius="lg" withBorder p="xl" h="100%" style={{ background: "var(--mantine-color-body)" }}>
                <Group justify="space-between" align="flex-start">
                  <ThemeIcon size={48} radius="md" color="brand" variant="light">
                    <s.icon size={24} />
                  </ThemeIcon>
                  <Text fw={600} style={{ fontSize: rem(40), color: "var(--mantine-color-default-border)" }}>
                    {i + 1}
                  </Text>
                </Group>
                <Title order={3} fz="xl" mt="md" mb="xs">
                  {s.title}
                </Title>
                <Text c="dimmed" style={{ lineHeight: 1.55 }}>
                  {s.text}
                </Text>
              </Paper>
            </Reveal>
          ))}
        </SimpleGrid>
      </Section>
    </>
  );
}
