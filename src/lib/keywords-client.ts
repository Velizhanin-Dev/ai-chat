"use client";

import type { KeywordStats } from "./keywords";
import type { VideoTagSet } from "./video-tags";

// Клиентские обёртки подбора ключей. ⚠️ Ни квоты тарифа, ни units YouTube эти
// вызовы не тратят (данные берутся мимо Data API), поэтому крутить подбор можно
// сколько угодно — в отличие от самого поиска роликов.

export async function apiKeywordSuggestions(query: string): Promise<string[]> {
  try {
    const res = await fetch(`/api/keywords?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { suggestions?: string[] };
    return data.suggestions ?? [];
  } catch {
    return [];
  }
}

export async function apiKeywordStats(queries: string[]): Promise<KeywordStats[]> {
  try {
    const res = await fetch("/api/keywords/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { stats?: KeywordStats[] };
    return data.stats ?? [];
  } catch {
    return [];
  }
}

/** Теги чужого ролика (в Data API их нет — см. /api/competitors/tags). */
export async function apiVideoTags(videoId: string): Promise<string[]> {
  try {
    const res = await fetch(`/api/competitors/tags?v=${encodeURIComponent(videoId)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { tags?: string[] };
    return data.tags ?? [];
  } catch {
    return [];
  }
}

/**
 * Банк тегов ниши по набору роликов: чем размечают тех, у кого уже сработало.
 * ⚠️ Как и теги одного ролика, это мимо Data API — квоту не тратит.
 */
export async function apiNicheTags(
  ids: string[]
): Promise<{ bank: { tag: string; count: number }[]; scanned: number }> {
  try {
    const res = await fetch("/api/competitors/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return { bank: [], scanned: 0 };
    const data = (await res.json()) as {
      bank?: { tag: string; count: number }[];
      scanned?: number;
    };
    return { bank: data.bank ?? [], scanned: data.scanned ?? 0 };
  } catch {
    return { bank: [], scanned: 0 };
  }
}

/**
 * 20 тегов для своего ролика по схеме 10 охватных / 8 свободных / 2 именных.
 * ⚠️ Стоит VIDEO_TAGS_QUOTA_COST запросов квоты (вызов модели); замер фраз через
 * выдачу units не тратит. refIds — верхние ролики текущей выдачи, их теги идут
 * кандидатами.
 */
export async function apiGenerateVideoTags(input: {
  projectId: string;
  topic: string;
  refIds: string[];
}): Promise<{ ok: true; set: VideoTagSet } | { ok: false; error: string; code?: string }> {
  try {
    const res = await fetch("/api/video-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as {
      set?: VideoTagSet;
      error?: string;
      code?: string;
    };
    if (!res.ok || !data.set) {
      return { ok: false, error: data.error ?? "Не удалось собрать теги", code: data.code };
    }
    return { ok: true, set: data.set };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}
