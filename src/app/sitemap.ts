import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Генерит /sitemap.xml. Только публично индексируемые страницы: лендинг + оферта +
// политика ПД. Приватные/гейтнутые роуты (chat, admin, payment, brief) сюда НЕ
// попадают — они и в robots.txt закрыты. lastModified — момент сборки.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/legal/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/legal/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
