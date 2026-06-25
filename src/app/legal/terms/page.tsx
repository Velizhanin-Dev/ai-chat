import type { Metadata } from "next";
import { Text, Anchor } from "@mantine/core";
import { LegalHeader, LegalBody } from "@/components/Legal/LegalDoc";
import { TERMS_TITLE, TERMS_BLOCKS } from "@/lib/legal-terms";

export const metadata: Metadata = {
  title: "Пользовательское соглашение — VELIZHANIN AI",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <>
      <LegalHeader title={TERMS_TITLE} />
      <LegalBody blocks={TERMS_BLOCKS} />
      <Text fz="sm" c="dimmed" mt="xl">
        См. также{" "}
        <Anchor href="/legal/privacy">
          Политику в отношении обработки персональных данных
        </Anchor>
        .
      </Text>
    </>
  );
}
