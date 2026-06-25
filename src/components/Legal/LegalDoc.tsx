import { Stack, Title, Text } from "@mantine/core";
import { LEGAL } from "@/lib/legal";

// Блок правового документа: заголовок раздела (h), абзац/пункт (p) или
// маркированный список (ul). Контент живёт в data-модулях (legal-privacy.ts /
// legal-terms.ts) — так страницы остаются тонкими, а текст легко править.
export type LegalBlock =
  | { h: string }
  | { p: string }
  | { ul: string[] };

// Шапка документа: заголовок + дата редакции.
export function LegalHeader({ title }: { title: string }) {
  return (
    <Stack gap={4} mb="xl">
      <Title order={1} className="lp-h2" style={{ fontSize: "clamp(1.7rem, 4vw, 2.3rem)" }}>
        {title}
      </Title>
      <Text size="sm" c="dimmed">
        Редакция от {LEGAL.updatedAt}
      </Text>
    </Stack>
  );
}

// Рендер тела документа из массива блоков.
export function LegalBody({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <Stack gap="md" fz="sm" style={{ lineHeight: 1.6 }}>
      {blocks.map((b, i) => {
        if ("h" in b) {
          return (
            <Title key={i} order={2} fz="lg" mt="md" style={{ letterSpacing: "-0.01em" }}>
              {b.h}
            </Title>
          );
        }
        if ("ul" in b) {
          return (
            <ul className="legal-list" key={i}>
              {b.ul.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          );
        }
        return <Text key={i}>{b.p}</Text>;
      })}
    </Stack>
  );
}
