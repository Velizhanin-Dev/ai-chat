import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Генерит /robots.txt. Закрываем приватные/гейтнутые зоны (чат, админка, API,
// страница оплаты, анонимный QR-бриф) — публично индексируем только маркетинг и
// юридические страницы. Карта сайта — абсолютной ссылкой.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/chat", "/admin", "/api/", "/payment", "/brief"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
