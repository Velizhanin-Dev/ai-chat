"use client";

import type { KeywordStats } from "./keywords";

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
