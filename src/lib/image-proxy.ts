// ── Превью роликов через зарубежный прокси ──────────────────────────────────
//
// Превью YouTube лежат на i.ytimg.com, и грузит их БРАУЗЕР пользователя напрямую.
// В России этот домен часто не открывается без VPN — карточки роликов на сайте
// оказываются пустыми, хотя данные пришли и всё остальное работает.
//
// Поэтому подменяем адрес картинки на путь нашего зарубежного сервера (там же, где
// Caddy проксирует Telegram и OpenRouter): `/img/vi/<id>/hqdefault.jpg`.
//
// ⚠️ Переменная NEXT_PUBLIC_* инлайнится ПРИ СБОРКЕ — на проде её нужно задать на
// build-стадии (в docker-compose args), иначе в бандл попадёт пустая строка и
// картинки снова пойдут напрямую.
// ⚠️ Не задана — возвращаем адрес как есть: локальная разработка и зарубежные
// пользователи так и работают, ничего не ломается.

const PROXY = (process.env.NEXT_PUBLIC_YT_IMG_PROXY || "").replace(/\/$/, "");

// Что проксируем: превью роликов, аватары каналов и баннеры — они лежат на разных
// доменах Google, и режет их все. Наши собственные файлы (/api/thumbnails/...)
// сюда не попадают и идут напрямую.
const HOSTS = [
  "i.ytimg.com",
  "i9.ytimg.com",
  "img.youtube.com",
  "yt3.ggpht.com",
  "yt3.googleusercontent.com",
  "lh3.googleusercontent.com",
];

/**
 * Адрес превью для <img src>. Возвращает прокси-путь, если прокси настроен и
 * картинка с YouTube; иначе — исходный адрес.
 */
export function ytImage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!PROXY) return url;

  try {
    const u = new URL(url);
    if (!HOSTS.includes(u.hostname)) return url;
    // ⚠️ Передаём АДРЕС ЦЕЛИКОМ параметром, а не подставляем путь к одному хосту:
    // превью, аватары и баннеры живут на разных доменах, и один общий эндпоинт
    // избавляет от отдельного пути в Caddyfile под каждый из них.
    return `${PROXY}/image?u=${encodeURIComponent(url)}`;
  } catch {
    // Не URL (относительный путь, мусор из старых данных) — не трогаем.
    return url;
  }
}

/** Превью по id ролика: адрес выводится из id, поход в API не нужен. */
export function ytThumbById(videoId: string, quality = "hqdefault"): string {
  const direct = `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;
  return PROXY ? `${PROXY}/image?u=${encodeURIComponent(direct)}` : direct;
}
