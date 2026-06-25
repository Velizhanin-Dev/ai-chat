"use client";

import { useState } from "react";
import Link from "next/link";
import { Box, Group, Stack, Paper, Title, Text, Button } from "@mantine/core";
import { IconArrowRight, IconRefresh } from "@tabler/icons-react";
import LogoMark from "@/components/Brand/LogoMark";
import BriefFlow from "@/components/Brief/BriefFlow";
import { writeAnonBrief } from "@/lib/anon-brief";
import { ymGoal } from "@/lib/metrika";
import type { Brief } from "@/lib/brief";

// Клиентская часть страницы брифа по QR. Гейт по фичефлагу briefPageEnabled —
// в серверном page.tsx (если выкл → 404), сюда уже доходим только когда включено.
//
// Анонимна (юзера/сессии нет): готовый бриф кладём в localStorage устройства
// (writeAnonBrief); при следующей регистрации/входе в этом браузере AppShell
// подхватит его и отправит на бэкенд — повторно проходить бриф не нужно.
//
// ВАЖНО: до экрана результата НЕ упоминаем AI/нейронку — это сюрприз в конце.
// Поэтому здесь нет AI ни в шапке (бренд без «AI»), ни в подзаголовке. AI
// раскрываем только в resultNote/CTA.

const DRAFT_KEY = "creative-chat:brief-draft-anon-v1";

export default function BriefStandaloneClient() {
  // Заголовок показываем только на самом первом вопросе; дальше прячем (флаг
  // приходит из BriefFlow через onAtStartChange).
  const [atStart, setAtStart] = useState(true);

  const handleSubmit = async (brief: Brief) => {
    writeAnonBrief(brief);
    ymGoal("brief_complete", { disc: brief.disc, source: "qr" });
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
          {atStart && (
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
          )}

          <Paper withBorder radius="lg" p={{ base: "md", sm: "xl" }}>
            <BriefFlow
              draftKey={DRAFT_KEY}
              draftScope="anon"
              onSubmit={handleSubmit}
              onAtStartChange={setAtStart}
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
