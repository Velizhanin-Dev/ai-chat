import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import "@mantine/dates/styles.css";
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
import { SITE_URL, SITE_NAME } from "@/lib/site";

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

const SITE_DESCRIPTION =
  "Создавайте YouTube-контент с ИИ-помощником Николая Велижанина: сценарии, хуки, идеи для роликов, Shorts и Reels по методике КМК студии VELIZHANIN.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    // На подстраницах (напр. /legal) подставляется «<тайтл страницы> — VELIZHANIN AI».
    default: "VELIZHANIN AI — AI-продюсер YouTube по методике Велижанина",
    template: "%s — VELIZHANIN AI",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "Николай Велижанин",
    "VELIZHANIN",
    "методика КМК",
    "AI-продюсер YouTube",
    "сценарий для YouTube",
    "идеи для Shorts",
    "Reels",
    "продвижение на YouTube",
    "AI-ассистент",
  ],
  openGraph: {
    type: "website",
    locale: "ru_RU",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "VELIZHANIN AI — AI-продюсер YouTube по методике Велижанина",
    description: SITE_DESCRIPTION,
    // TODO: заменить на полноценный баннер 1200×630; пока — квадратный лого-фолбэк.
    images: [
      { url: "/android-chrome-512x512.png", width: 512, height: 512, alt: SITE_NAME },
    ],
  },
  twitter: {
    card: "summary",
    title: "VELIZHANIN AI — AI-продюсер YouTube по методике Велижанина",
    description: SITE_DESCRIPTION,
    images: ["/android-chrome-512x512.png"],
  },
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
        {/* Структурированные данные для брендового поиска (Велижанин ↔ продукт). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: SITE_NAME,
                url: SITE_URL,
                inLanguage: "ru-RU",
              },
              {
                "@context": "https://schema.org",
                "@type": "Organization",
                name: SITE_NAME,
                url: SITE_URL,
                logo: `${SITE_URL}/android-chrome-512x512.png`,
                founder: { "@type": "Person", name: "Николай Велижанин" },
              },
            ]),
          }}
        />
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
