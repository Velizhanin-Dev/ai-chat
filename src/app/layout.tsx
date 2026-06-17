import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "./globals.css";

import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { MantineProvider, ColorSchemeScript } from "@mantine/core";
import StoreProvider from "@/store/StoreProvider";
import AppShellLayout from "@/components/Shell/AppShell";
import CookieBanner from "@/components/CookieBanner";
import { theme } from "@/theme";

// Рабочий фолбэк к фирменному RandomGrotesque: близкий по характеру grotesque
// с поддержкой кириллицы. Подставляется через CSS-переменную --font-brand.
const brandFont = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-brand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VELIZHANIN AI",
  description: "AI-ассистент по методике YouTube-контента Николая Велижанина",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/logo.png", type: "image/png" },
    ],
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={brandFont.variable} suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        <MantineProvider defaultColorScheme="auto" theme={theme}>
          <StoreProvider>
            <AppShellLayout>{children}</AppShellLayout>
            <CookieBanner />
          </StoreProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
