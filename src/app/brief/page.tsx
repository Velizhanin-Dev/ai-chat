"use client";

import Link from "next/link";
import { Box, Group, Stack, Paper, Title, Text, Button } from "@mantine/core";
import { IconArrowRight, IconRefresh } from "@tabler/icons-react";
import LogoMark from "@/components/Brand/LogoMark";
import BriefFlow from "@/components/Brief/BriefFlow";
import { writeAnonBrief } from "@/lib/anon-brief";
import type { Brief } from "@/lib/brief";

// ── Страница брифа по QR-коду ───────────────────────────────────────────────
// Анонимна (юзера/сессии нет): попадают сюда только по прямой ссылке/QR, в
// навигации её нет. Готовый бриф кладём в localStorage устройства (writeAnonBrief);
// при следующей регистрации/входе в этом браузере AppShell подхватит его и
// отправит на бэкенд — повторно проходить бриф не нужно. Тот же визард, что и в
// модалке онбординга (BriefFlow), все поля «о проекте» можно пропустить.
//
// ВАЖНО: до экрана результата НЕ упоминаем AI/нейронку — это сюрприз в конце.
// Поэтому здесь нет AI ни в шапке (бренд без «AI»), ни в подзаголовке, ни ссылки
// «На сайт» (она вела бы на лендинг продукта). AI раскрываем только в resultNote/CTA.

const DRAFT_KEY = "creative-chat:brief-draft-anon-v1";

export default function BriefStandalonePage() {
  const handleSubmit = async (brief: Brief) => {
    writeAnonBrief(brief);
    return { ok: true };
  };

  return (
    <Box
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--mantine-color-body)",
      }}
    >
      <Group p="md">
        {/* Бренд без «AI» — на старте брифа нейронку не светим (см. шапку файла). */}
        <Group gap="xs" wrap="nowrap">
          <LogoMark box="lg" glyph={22} />
          <Text fw={600} fz="lg" style={{ letterSpacing: "-0.02em" }}>
            VELIZHANIN
          </Text>
        </Group>
      </Group>

      <Box
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "16px 16px max(40px, env(safe-area-inset-bottom))",
        }}
      >
        <Stack gap="lg" w="100%" maw={520}>
          <div>
            <Title order={2} className="lp-h2" style={{ fontSize: "1.8rem" }}>
              Знакомство перед стартом
            </Title>
            <Text c="dimmed" mt={6}>
              Пара вопросов о проекте — их можно пропустить — и короткий тест.
              Узнаешь свой типаж на камере: как ты в кадре, что тебя заводит, а
              что бесит.
            </Text>
          </div>

          <Paper withBorder radius="lg" p={{ base: "md", sm: "xl" }}>
            <BriefFlow
              draftKey={DRAFT_KEY}
              draftScope="anon"
              onSubmit={handleSubmit}
              resultNote={
                <Text size="sm" c="dimmed">
                  Запомнили твой типаж и бриф на этом устройстве. Заходи в наш AI —
                  он сразу будет собирать контент с учётом этого, бриф проходить
                  заново не придётся.
                </Text>
              }
              resultActions={({ restart }) => (
                <Group gap="sm">
                  <Button
                    variant="subtle"
                    color="gray"
                    radius="md"
                    leftSection={<IconRefresh size={16} />}
                    onClick={restart}
                  >
                    Пройти заново
                  </Button>
                  <Button
                    component={Link}
                    href="/"
                    color="brand"
                    radius="md"
                    rightSection={<IconArrowRight size={16} />}
                  >
                    Попробовать AI
                  </Button>
                </Group>
              )}
            />
          </Paper>
        </Stack>
      </Box>
    </Box>
  );
}
