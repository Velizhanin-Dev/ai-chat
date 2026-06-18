import "@mantine/core/styles.css";
import "./globals.css";

import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { MantineProvider, ColorSchemeScript } from "@mantine/core";
import StoreProvider from "@/store/StoreProvider";
import AppShellLayout from "@/components/Shell/AppShell";
import CookieBanner from "@/components/CookieBanner";
import { theme } from "@/theme";
import { getSessionUser, publicUser } from "@/lib/auth";
import type { AuthUser } from "@/store/authSlice";

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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // SSR-засев юзера из серверной cookie: стор стартует уже с актуальным
  // пользователем, поэтому шапка/сайдбар не моргают «Войти → аккаунт».
  // Для гостя getSessionUser быстро вернёт null (без запроса в БД).
  const sessionUser = await getSessionUser();
  const initialUser: AuthUser | null = sessionUser
    ? (publicUser(sessionUser) as AuthUser)
    : null;

  return (
    <html lang="ru" className={brandFont.variable} suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        <MantineProvider defaultColorScheme="auto" theme={theme}>
          <StoreProvider initialUser={initialUser}>
            <AppShellLayout>{children}</AppShellLayout>
            <CookieBanner />
          </StoreProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
