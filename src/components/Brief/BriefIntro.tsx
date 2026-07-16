"use client";

import { Box, Stack, Group, Text, Title, Button, ThemeIcon } from "@mantine/core";
import {
  IconArrowRight,
  IconClipboardText,
  IconSparkles,
  IconCamera,
} from "@tabler/icons-react";

// Стартовая заставка перед брифом на /brief — «Узнай свою харизму».
// Это хук: коротко объясняем, что внутри, и зовём пройти тест. Кнопка «Пройти»
// прижата к низу экрана (mt:auto в flex-колонке высотой во весь контент).
//
// ВАЖНО (как и во всём брифе): до экрана результата НЕ упоминаем AI/нейронку —
// это сюрприз в конце. Здесь продаём только сам тест и типаж на камере.

const POINTS = [
  {
    icon: IconClipboardText,
    title: "Пара вопросов о проекте",
    desc: "Коротко и по делу — что-то можно пропустить.",
  },
  {
    icon: IconSparkles,
    title: "Короткий тест о тебе",
    desc: "Отвечай по первому ощущению — правильных ответов нет.",
  },
  {
    icon: IconCamera,
    title: "Твой типаж на камере",
    desc: "Узнаешь, как ты в кадре: что заводит, а что бесит.",
  },
];

export default function BriefIntro({ onStart }: { onStart: () => void }) {
  return (
    <Box
      className="lp-hero-bg"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "24px 16px max(40px, env(safe-area-inset-bottom))",
      }}
    >
      <Stack gap="xl" w="100%" maw={560} className="bi-rise">
        <Stack gap="md" align="flex-start">
          <Title
            order={1}
            className="lp-display"
            style={{ fontSize: "clamp(2.2rem, 7vw, 3.2rem)" }}
          >
            Узнай свою{" "}
            <Text span inherit c="brand">
              харизму
            </Text>
          </Title>

          <Text fz={{ base: "md", sm: "lg" }} c="dimmed" maw={460}>
            Ответь на пару вопросов и пройди короткий тест. В конце откроем твой
            типаж на камере — один из 9 ярких архетипов.
          </Text>
        </Stack>

        <Stack gap="md">
          {POINTS.map((p) => (
            <Group key={p.title} gap="md" wrap="nowrap" align="flex-start">
              <ThemeIcon
                color="brand"
                variant="light"
                radius="md"
                size={42}
                style={{ flexShrink: 0 }}
              >
                <p.icon size={22} />
              </ThemeIcon>
              <div>
                <Text fw={600}>{p.title}</Text>
                <Text size="sm" c="dimmed">
                  {p.desc}
                </Text>
              </div>
            </Group>
          ))}
        </Stack>
      </Stack>

      {/* CTA прижат к низу экрана */}
      <Box w="100%" maw={560} mt="auto" pt="xl">
        <Button
          onClick={onStart}
          color="brand"
          size="lg"
          radius="md"
          fullWidth
          rightSection={<IconArrowRight size={18} />}
        >
          Пройти
        </Button>
      </Box>
    </Box>
  );
}
