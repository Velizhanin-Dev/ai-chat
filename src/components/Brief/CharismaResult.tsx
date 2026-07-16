"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconBolt,
  IconDeviceTvOld,
  IconFlame,
  IconShieldHalf,
  IconUsers,
} from "@tabler/icons-react";
import type { DiscProfile } from "@/lib/brief";

// ── Красивый экран результата брифа — «карта харизмы» пользователя ───────────
// Презентационный reveal типажа: крупный герой (образ + имя + девиз), портрет
// «вот какой ты», сетка блоков (суперсила / форматы / что заводит / слабые места)
// и «на кого ты похож». Пишем в голосе «ты», позитивно — это для ПОЛЬЗОВАТЕЛЯ,
// не для продюсера (служебные character/kills сюда НЕ выводим).
//
// Адаптив: на десктопе — двухколоночный герой (текст + образ) и сетка 2×2; на
// мобиле всё в одну колонку. Появление блоков — стаггер-анимация .cr-rise
// (globals.css, гасится при prefers-reduced-motion). Рендерится и в узком
// контейнере (модалка брифа), и на всю ширину (родитель расширяет на результат).
//
// Образ типа — /public/images/disc/{code}.webp (есть для всех 9). Если файла нет
// (onError) — рисуем брендовый плейсхолдер с кодом, чтобы экран не ломался.

interface InfoCardProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  tone?: "brand" | "gray";
  delay: number;
}

function InfoCard({ icon, title, children, tone = "brand", delay }: InfoCardProps) {
  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
      className="cr-rise"
      style={{ animationDelay: `${delay}ms`, height: "100%" }}
    >
      <Group gap="xs" mb={8} wrap="nowrap">
        <ThemeIcon
          color={tone === "gray" ? "gray" : "brand"}
          variant="light"
          radius="md"
          size="md"
        >
          {icon}
        </ThemeIcon>
        <Text fw={600} fz="sm">
          {title}
        </Text>
      </Group>
      <Text fz="sm" c="dimmed" style={{ lineHeight: 1.55 }}>
        {children}
      </Text>
    </Paper>
  );
}

export interface CharismaResultProps {
  profile: DiscProfile;
  // Смешанный тип (перекрёстная тройка теста): результат выдаём всегда, но добавляем
  // приписку, что тип проявляется по-разному, а показанный — доминирующий.
  isMixed?: boolean;
  // Слоты под карточкой: пояснение (resultNote) и кнопки (resultActions).
  note?: React.ReactNode;
  actions?: React.ReactNode;
}

export default function CharismaResult({
  profile,
  isMixed = false,
  note,
  actions,
}: CharismaResultProps) {
  const [imgError, setImgError] = useState(false);
  // Сброс ошибки картинки при смене типа (напр. «пройти заново» без ремоунта).
  useEffect(() => setImgError(false), [profile.code]);
  const hasImage = !imgError;

  const hero = hasImage ? (
    // Плейн <img> (в проекте не используют next/image — оптимизатор в проде без sharp).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/images/disc/${profile.code}.webp`}
      alt={`Типаж «${profile.nick}»`}
      onError={() => setImgError(true)}
      className="cr-hero-img"
    />
  ) : (
    <Box className="cr-hero-fallback" aria-hidden>
      <Text className="cr-hero-fallback-glyph">{profile.code}</Text>
    </Box>
  );

  return (
    <Box maw={860} mx="auto" w="100%">
      {/* ── Герой: образ + имя + девиз ─────────────────────────────────────── */}
      <Paper withBorder radius="xl" p={{ base: "lg", sm: "xl" }} className="cr-hero cr-rise">
        <div className="cr-hero-grid">
          <div className="cr-hero-media">{hero}</div>
          <Stack gap="xs" justify="center">
            <Group gap="xs">
              <Badge color="brand" variant="light" radius="sm" size="sm">
                Твой типаж на камере
              </Badge>
              <Badge color="gray" variant="outline" radius="sm" size="sm">
                {profile.code}
              </Badge>
            </Group>
            <Title
              order={1}
              className="lp-h2"
              fz={{ base: "1.9rem", sm: "2.6rem" }}
              lh={1.05}
            >
              <span aria-hidden style={{ marginRight: "0.35em" }}>
                {profile.emoji}
              </span>
              «{profile.nick}»
            </Title>
            <Text fz={{ base: "md", sm: "lg" }} fw={500} c="brand">
              {profile.tagline}
            </Text>
          </Stack>
        </div>

        <Text fz={{ base: "sm", sm: "md" }} mt="lg" style={{ lineHeight: 1.65 }}>
          {profile.portrait}
        </Text>

        {/* Смешанный тип — приписка (результат всё равно показан). */}
        {isMixed && (
          <Text fz="sm" mt="md" fs="italic" c="dimmed">
            Твой тип харизмы проявляется по-разному в зависимости от ситуации. Но
            доминирующий — вот.
          </Text>
        )}
      </Paper>

      {/* ── Сетка блоков ───────────────────────────────────────────────────── */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" mt="md">
        <InfoCard icon={<IconBolt size={18} />} title="Твоя суперсила" delay={60}>
          {profile.superpower}
        </InfoCard>
        <InfoCard
          icon={<IconDeviceTvOld size={18} />}
          title="Форматы под тебя"
          delay={120}
        >
          {profile.formats}
        </InfoCard>
        <InfoCard icon={<IconFlame size={18} />} title="Что тебя заводит" delay={180}>
          {profile.works}
        </InfoCard>
        <InfoCard
          icon={<IconShieldHalf size={18} />}
          title="На что обратить внимание"
          tone="gray"
          delay={240}
        >
          {profile.weakness}
        </InfoCard>
      </SimpleGrid>

      {/* ── На кого ты похож ───────────────────────────────────────────────── */}
      {profile.examples.length > 0 && (
        <Paper
          withBorder
          radius="lg"
          p="md"
          mt="md"
          className="cr-rise"
          style={{ animationDelay: "300ms" }}
        >
          <Group gap="xs" mb={10} wrap="nowrap">
            <ThemeIcon color="brand" variant="light" radius="md" size="md">
              <IconUsers size={18} />
            </ThemeIcon>
            <Text fw={600} fz="sm">
              На кого ты похож
            </Text>
          </Group>
          <Group gap="xs">
            {profile.examples.map((name) => (
              <Badge
                key={name}
                variant="light"
                color="gray"
                radius="sm"
                size="lg"
                styles={{ label: { textTransform: "none", fontWeight: 500 } }}
              >
                {name}
              </Badge>
            ))}
          </Group>
        </Paper>
      )}

      {/* Слоты родителя: пояснение + кнопки. */}
      {note && (
        <Box mt="lg" className="cr-rise" style={{ animationDelay: "360ms" }}>
          {note}
        </Box>
      )}
      {actions && (
        <Group justify="flex-end" mt="md" className="cr-rise" style={{ animationDelay: "400ms" }}>
          {actions}
        </Group>
      )}
    </Box>
  );
}
