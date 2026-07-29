"use client";

import Link from "next/link";
import { Box, Button, Group, SimpleGrid, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import {
  IconBolt,
  IconBrandYoutube,
  IconBulb,
  IconCalendarMonth,
  IconChartLine,
  IconDeviceMobile,
  IconMovie,
  IconPhoto,
  IconTextCaption,
} from "@tabler/icons-react";
import { useAppDispatch } from "@/store/hooks";
import { prefillInput } from "@/store/chatSlice";

// Стартовый экран пустого чата: «что я умею». Плитки — не декорация, а готовые
// запросы: клик подставляет текст в композер (через chatSlice.prefillInput), юзер
// дополняет под себя и отправляет. Формулировки — под категории роутера знаний
// (short/long/content_plan/method), чтобы плитка сразу попадала в нужный слой базы.
//
// Если канал не подключён — первой идёт primary-кнопка «Подключить канал»: с ним
// ассистент разбирает канал по цифрам, без него отвечает вслепую.

interface Suggestion {
  icon: React.ReactNode;
  title: string;
  // Что уедет в поле ввода. Оставляем «незаконченным» там, где нужна конкретика
  // от пользователя — он допишет свою тему перед отправкой.
  prompt: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: <IconTextCaption size={20} />,
    title: "Названия по ВИСП",
    prompt: "Придумай 7 названий для ролика на тему: ",
  },
  {
    icon: <IconPhoto size={20} />,
    title: "Текст на превью",
    prompt:
      "Придумай 5 вариантов текста на превью (3-5 слов) для ролика на тему: ",
  },
  {
    icon: <IconCalendarMonth size={20} />,
    title: "Контент-план на месяц",
    prompt: "Собери контент-план на месяц для моего канала",
  },
  {
    icon: <IconDeviceMobile size={20} />,
    title: "Сценарий шортса",
    prompt: "Напиши сценарий шортса на тему: ",
  },
  {
    icon: <IconMovie size={20} />,
    title: "Сценарий для видео",
    prompt: "Напиши сценарий длинного ролика на тему: ",
  },
  {
    icon: <IconBolt size={20} />,
    title: "Хук и опенинг",
    prompt:
      "Дай 5 вариантов захода на первые 10 секунд, чтобы не отваливались. Тема ролика: ",
  },
  {
    icon: <IconBulb size={20} />,
    title: "Идеи тем",
    prompt: "Накидай 10 тем для роликов в моей нише",
  },
  {
    icon: <IconChartLine size={20} />,
    title: "Почему не залетело",
    prompt:
      "Разбери, почему ролик не набрал просмотров. Название, превью и цифры такие: ",
  },
];

export default function ChatWelcome({
  projectId,
  ytConnected,
}: {
  projectId: string | null;
  // null — ещё не знаем (не мигаем кнопкой подключения).
  ytConnected: boolean | null;
}) {
  const dispatch = useAppDispatch();

  return (
    <Box py={{ base: "md", sm: 40 }} px={{ base: 0, sm: "xs" }}>
      <Stack gap={4} align="center" mb="xl">
        <Text fz={{ base: "1.35rem", sm: "1.6rem" }} fw={700} ta="center">
          Чем помочь?
        </Text>
        <Text c="dimmed" size="sm" ta="center" maw={520}>
          Выбери, с чего начать — текст подставится в поле ввода, останется дописать
          свою тему. Или просто спроси своими словами.
        </Text>
      </Stack>

      {/* Подключение канала — самая ценная кнопка, поэтому primary и над плитками. */}
      {ytConnected === false && projectId && (
        <Group justify="center" mb="lg">
          <Button
            component={Link}
            href={`/${projectId}/settings?tab=integrations`}
            color="brand"
            size="md"
            radius="md"
            leftSection={<IconBrandYoutube size={20} />}
          >
            Подключить YouTube-канал
          </Button>
        </Group>
      )}

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="sm">
        {SUGGESTIONS.map((s) => (
          <UnstyledButton
            key={s.title}
            className="chat-suggestion"
            onClick={() => dispatch(prefillInput(s.prompt))}
          >
            <Group gap="sm" wrap="nowrap" align="center">
              <ThemeIcon
                size="lg"
                radius="md"
                variant="light"
                color="brand"
                style={{ flexShrink: 0 }}
              >
                {s.icon}
              </ThemeIcon>
              <Text size="sm" fw={500} style={{ minWidth: 0 }}>
                {s.title}
              </Text>
            </Group>
          </UnstyledButton>
        ))}
      </SimpleGrid>
    </Box>
  );
}
