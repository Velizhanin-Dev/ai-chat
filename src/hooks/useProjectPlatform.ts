"use client";

import { useParams } from "next/navigation";
import { useAppSelector } from "@/store/hooks";
import { platformMeta, type Platform, type PlatformMeta } from "@/lib/platform";

// Площадка ОТКРЫТОГО проекта (по projectId из URL). Список проектов уже лежит в
// сторе — его тянет AppShell при входе, — поэтому лишнего запроса не делаем.
//
// ⚠️ Пока список не пришёл, отдаём "youtube": это площадка по умолчанию и у всех
// старых проектов. Мигание с YouTube на Instagram на долю секунды безобиднее, чем
// пустой экран без разделов.
export function useProjectPlatform(): { platform: Platform; meta: PlatformMeta } {
  const params = useParams();
  const projectId = typeof params?.projectId === "string" ? params.projectId : "";
  const platform = useAppSelector(
    (s) => s.chat.conversations.find((c) => c.id === projectId)?.platform ?? "youtube"
  );
  return { platform, meta: platformMeta(platform) };
}
