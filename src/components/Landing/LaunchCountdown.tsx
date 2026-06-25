"use client";

import { useEffect, useState } from "react";
import { Box, Paper, Group, Stack, Text } from "@mantine/core";

// Анимированный обратный отсчёт «до запуска AI-ассистента». Показывается в герое
// лендинга, когда включён pre-launch (см. settings.launch). Время считаем на
// клиенте: до маунта рендерим прочерки (без hydration mismatch), затем тикаем.

interface Parts {
  d: number;
  h: number;
  m: number;
  s: number;
  done: boolean;
}

function partsTo(target: number): Parts {
  const ms = Math.max(0, target - Date.now());
  const total = Math.floor(ms / 1000);
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
    done: ms === 0,
  };
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

export default function LaunchCountdown({ targetAt }: { targetAt: string }) {
  const target = new Date(targetAt).getTime();
  const [t, setT] = useState<Parts | null>(null);

  useEffect(() => {
    setT(partsTo(target));
    const id = setInterval(() => setT(partsTo(target)), 1000);
    return () => clearInterval(id);
  }, [target]);

  const cells: { value: string; label: string }[] = [
    { value: t ? pad(t.d) : "––", label: "дней" },
    { value: t ? pad(t.h) : "––", label: "часов" },
    { value: t ? pad(t.m) : "––", label: "минут" },
    { value: t ? pad(t.s) : "––", label: "секунд" },
  ];

  return (
    <Paper
      radius="lg"
      p={{ base: "md", sm: "lg" }}
      className="launch-countdown"
      maw={560}
      mx="auto"
      w="100%"
    >
      <Text ta="center" fw={600} c="dimmed" tt="uppercase" fz="sm" style={{ letterSpacing: "0.08em" }}>
        {t?.done ? "Запускаемся" : "До запуска AI-ассистента осталось"}
      </Text>

      {!t?.done ? (
        <Group justify="center" gap="sm" mt="md" wrap="nowrap">
          {cells.map((c, i) => (
            <Group key={c.label} gap="sm" wrap="nowrap">
              <Stack gap={2} align="center">
                <Box className="launch-countdown__cell">
                  {/* key=значение → ремаунт и анимация «пульса» при смене цифры */}
                  <span key={c.value} className="launch-countdown__num">
                    {c.value}
                  </span>
                </Box>
                <Text fz="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: "0.06em" }}>
                  {c.label}
                </Text>
              </Stack>
              {i < cells.length - 1 && (
                <Text className="launch-countdown__sep" aria-hidden>
                  :
                </Text>
              )}
            </Group>
          ))}
        </Group>
      ) : (
        <Text ta="center" className="lp-display" mt="xs" style={{ fontSize: "2rem", color: "var(--color-accent)" }}>
          🚀 Уже здесь
        </Text>
      )}
    </Paper>
  );
}
