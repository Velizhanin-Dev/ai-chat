import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Брендовая акцентная шкала вокруг #EC582E (база = индекс 6).
// Источник палитры — лендинг velizhanin.com, см. docs/design-system.md.
const brand: MantineColorsTuple = [
  "#FFF0EB",
  "#FFE0D6",
  "#FFC0AD",
  "#FF9D80",
  "#F97D57",
  "#F26538",
  "#EC582E", // основной акцент
  "#D9431C",
  "#B3360F",
  "#8F2A0A",
];

export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: 6,
  colors: { brand },

  // RandomGrotesque (коммерческий, ставится при наличии) → Manrope из next/font
  // (переменная --font-brand задаётся в layout.tsx) → системный фолбэк.
  fontFamily:
    '"RandomGrotesque", var(--font-brand), system-ui, -apple-system, Arial, sans-serif',
  headings: {
    fontFamily:
      '"RandomGrotesque", var(--font-brand), system-ui, Arial, sans-serif',
    fontWeight: "600",
  },

  defaultRadius: "md",
  radius: { sm: "10px", md: "15px", lg: "20px", xl: "30px" },

  black: "#212121",
});
