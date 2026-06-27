// Канонический URL сайта — для метадаты (metadataBase, OG), sitemap.xml и robots.
// В проде задаётся через NEXT_PUBLIC_APP_URL (тот же домен, что Caddy {$DOMAIN};
// www там 301-редиректит на апекс, так что апекс — канонический). Фолбэк на случай,
// если переменная не задана на сборке. Трейлинг-слэш срезаем, чтобы не плодить //.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://velizhanin.com"
).replace(/\/+$/, "");

export const SITE_NAME = "VELIZHANIN AI";
