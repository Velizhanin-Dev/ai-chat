import type { Metadata } from "next";
import { Text, Anchor } from "@mantine/core";
import { LegalHeader, LegalBody } from "@/components/Legal/LegalDoc";
import { PRIVACY_TITLE, PRIVACY_BLOCKS } from "@/lib/legal-privacy";

export const metadata: Metadata = {
  title: "Политика конфиденциальности — VELIZHANIN AI",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <>
      <LegalHeader title={PRIVACY_TITLE} />
      <LegalBody blocks={PRIVACY_BLOCKS} />
      <Text fz="sm" c="dimmed" mt="xl">
        См. также{" "}
        <Anchor href="/legal/terms">Пользовательское соглашение</Anchor>.
      </Text>
    </>
  );
}
