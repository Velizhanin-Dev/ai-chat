import { cookies } from "next/headers";
import { sanitizeTouch, EMPTY_TOUCH, type UtmTouch } from "./utm";
import { UTM_COOKIE } from "./utm-client";

// Первое касание из cookie — для серверных сценариев, где localStorage
// недоступен. Главный потребитель — колбэк OAuth (VK/Яндекс): аккаунт там
// создаётся на сервере после редиректов, и метку взять больше неоткуда.
export function readUtmTouchCookie(): UtmTouch {
  try {
    const raw = cookies().get(UTM_COOKIE)?.value;
    if (!raw) return EMPTY_TOUCH;
    return sanitizeTouch(JSON.parse(decodeURIComponent(raw)));
  } catch {
    // Битая/чужая cookie — просто считаем, что метки нет.
    return EMPTY_TOUCH;
  }
}
