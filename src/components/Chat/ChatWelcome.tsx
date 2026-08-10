"use client";

import Link from "next/link";
import { Box, Button, Group, SimpleGrid, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import { IconBrandYoutube } from "@tabler/icons-react";
import { useAppDispatch } from "@/store/hooks";
import { prefillInput } from "@/store/chatSlice";
import { SUGGESTIONS } from "./suggestions";

// Стартовый экран пустого чата: «что я умею». Плитки — не декорация, а готовые
// запросы: клик подставляет текст в композер (через chatSlice.prefillInput), юзер
// дополняет под себя и отправляет. Сам список — в ./suggestions (общий с лентой
// быстрых действий над полем ввода, QuickActions).
//
// Если канал не подключён — первой идёт primary-кнопка «Подключить канал»: с ним
// ассистент разбирает канал по цифрам, без него отвечает вслепую.

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
