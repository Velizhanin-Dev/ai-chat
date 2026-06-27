import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { MantineProvider, ColorSchemeScript } from "@mantine/core";
import StoreProvider from "@/store/StoreProvider";
import AppShellLayout from "@/components/Shell/AppShell";
import CookieBanner from "@/components/CookieBanner";
import YandexMetrika from "@/components/Analytics/YandexMetrika";
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

// На мобиле клавиатура должна «сжимать» контент (resizes-content), чтобы поле
// ввода чата оставалось над ней, а сообщения скроллились, а не уезжали под
// клавиатуру. Ширину/масштаб задаём явно (иначе кастомный viewport их сбросит).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  title: "VELIZHANIN AI",
  description: "AI-ассистент по методике YouTube-контента Николая Велижанина",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      // Тёмная вкладка браузера → белое лого, светлая → чёрное (media-варианты).
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-32x32-white.png", type: "image/png", sizes: "32x32", media: "(prefers-color-scheme: dark)" },
      { url: "/favicon-16x16-white.png", type: "image/png", sizes: "16x16", media: "(prefers-color-scheme: dark)" },
    ],
    apple: "/apple-touch-icon.png",
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
        <YandexMetrika />
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
