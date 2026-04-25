import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "./globals.css";

import type { Metadata } from "next";
import { MantineProvider, ColorSchemeScript } from "@mantine/core";
import StoreProvider from "@/store/StoreProvider";
import AppShellLayout from "@/components/Shell/AppShell";

export const metadata: Metadata = {
  title: "VELIZHANIN AI",
  description: "AI-ассистент по методике YouTube-контента Николая Велижанина",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        <MantineProvider
          defaultColorScheme="auto"
          theme={{
            primaryColor: "blue",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <StoreProvider>
            <AppShellLayout>{children}</AppShellLayout>
          </StoreProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
