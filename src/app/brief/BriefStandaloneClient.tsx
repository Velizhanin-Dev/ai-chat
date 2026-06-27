"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Box, Group, Stack, Paper, Text, Loader } from "@mantine/core";
import LogoMark from "@/components/Brand/LogoMark";
import BriefFlow, { hasBriefDraftProgress } from "@/components/Brief/BriefFlow";
import BriefIntro from "@/components/Brief/BriefIntro";
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

// checking — читаем localStorage (без вспышки заставки, если бриф уже начат);
// intro — стартовая заставка «Узнай свою харизму»; flow — сам визард брифа.
type Phase = "checking" | "intro" | "flow";

export default function BriefStandaloneClient() {
  const [phase, setPhase] = useState<Phase>("checking");

  // На маунте решаем: если бриф уже начат (есть черновик с прогрессом) — сразу в
  // визард (BriefFlow восстановит позицию на незаполненном вопросе); иначе
  // показываем заставку. localStorage только на клиенте → читаем в эффекте.
  useEffect(() => {
    setPhase(hasBriefDraftProgress(DRAFT_KEY, "anon") ? "flow" : "intro");
  }, []);

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
        {/* Бренд без «AI» — на старте брифа нейронку не светим (см. шапку файла).
            Кликабелен целиком (иконка + текст) → на главную, как и везде. */}
        <Link
          href="/"
          style={{ textDecoration: "none", color: "inherit" }}
          aria-label="VELIZHANIN — на главную"
        >
          <Group gap="xs" wrap="nowrap">
            <LogoMark box="lg" glyph={22} />
            <Text fw={600} fz="lg" style={{ letterSpacing: "-0.02em" }}>
              VELIZHANIN
            </Text>
          </Group>
        </Link>
      </Group>

      {phase === "checking" && (
        <Group justify="center" align="center" style={{ flex: 1 }}>
          <Loader color="brand" />
        </Group>
      )}

      {phase === "intro" && <BriefIntro onStart={() => setPhase("flow")} />}

      {phase === "flow" && (
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
            <Paper withBorder radius="lg" p={{ base: "md", sm: "xl" }}>
              {/* На финале — просто карточка типажа как есть: без кнопок
                  «Пройти заново»/«Попробовать AI» и без AI-пояснения. */}
              <BriefFlow
                draftKey={DRAFT_KEY}
                draftScope="anon"
                onSubmit={handleSubmit}
              />
            </Paper>
          </Stack>
        </Box>
      )}
    </Box>
  );
}
