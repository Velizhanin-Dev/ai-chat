"use client";

import { useMemo, useRef, useState } from "react";
import { Box, Group, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { YouTubeVideo } from "@/lib/youtube-types";
import { formatCount, formatDate, durationToSeconds } from "@/lib/youtube-client";

// Матрица «упаковка ↔ содержание» — главный диагностический экран раздела.
// Каждый ролик — точка: по горизонтали сколько он собрал просмотров ОТНОСИТЕЛЬНО
// медианы канала (лог-шкала), по вертикали — удержание. Четыре угла отвечают на
// вопрос «что чинить»:
//   • много смотрят + досматривают   → работает, повторять;
//   • мало смотрят + досматривают    → упаковка: не кликают на превью/название;
//   • много смотрят + не досматривают→ обманка: превью обещает не то, слабый хук;
//   • мало смотрят + не досматривают → провал по обоим фронтам.
// Такого разреза в YouTube Studio нет — там метрики живут на разных экранах и
// не сопоставлены друг с другом.

const W = 640;
const H = 380;
const PAD = { top: 26, right: 18, bottom: 34, left: 46 };
// Горизонтальная шкала — во сколько раз ролик разошёлся против медианы канала.
// Кламп на 8× в обе стороны, чтобы один залетевший ролик не сплющил остальные.
const X_MAX = 3; // log2, то есть 8×
// Радиус видимой точки и НЕВИДИМОЙ зоны тапа (в координатах viewBox). На узком
// экране SVG ужимается примерно вдвое, поэтому там обе величины крупнее — иначе
// в точку не попасть пальцем.
const DOT_R = 7;
const DOT_HIT = 13;
const DOT_R_MOBILE = 9;
const DOT_HIT_MOBILE = 22;

export type MatrixQuadrant = "works" | "packaging" | "bait" | "fail";
// Тип контента, под который считается матрица. Лечение у лонга и шортса разное:
// у лонга проблема чаще в упаковке и монтаже, у шортса — в хуке и эмоции.
export type MatrixKind = "long" | "shorts";

// Ролики короче этого — шортсы. YouTube поднял планку до 3 минут (раньше 60 с).
export const SHORTS_MAX_SECONDS = 180;

// Подписи углов ЗАВИСЯТ от типа контента: это не украшение, а инструкция «что
// чинить». Для лонга «провал» = теги/описание (не находят), для шортса тот же
// угол — «долина смерти», где спасать нечего.
const QUADRANT_META_LONG: Record<
  MatrixQuadrant,
  { label: string; color: string; hint: string }
> = {
  works: {
    label: "Работает",
    color: "teal",
    hint: "И кликают, и досматривают. Разбирай, что сработало, и повторяй.",
  },
  packaging: {
    label: "Меняй превью и название",
    color: "brand",
    hint: "Контент держит, но заходят мало — вопрос к превью и названию.",
  },
  bait: {
    label: "Меняй монтаж, вырезай воду",
    color: "grape",
    hint: "Зашли хорошо, но не досмотрели: провисает монтаж, много воды.",
  },
  fail: {
    label: "Меняй теги и описание",
    color: "red",
    hint: "Ролик не находят: правь теги, описание и заголовок под запросы.",
  },
};

const QUADRANT_META_SHORTS: Record<
  MatrixQuadrant,
  { label: string; color: string; hint: string }
> = {
  works: {
    label: "Работает",
    color: "teal",
    hint: "И залетает, и досматривают. Разбирай, что сработало, и повторяй.",
  },
  packaging: {
    label: "Не вызвал эмоций",
    color: "brand",
    hint: "Досматривают, но нет лайков и комментов — пересними с эмоцией.",
  },
  bait: {
    label: "Слабый хук",
    color: "grape",
    hint: "Заходят, но отваливаются в первые секунды — слабый хук и начало.",
  },
  fail: {
    label: "Долина смерти",
    color: "red",
    hint: "Не смотрят и не досматривают. Тут не спасти — переснимай заново.",
  },
};

export function quadrantMeta(kind: MatrixKind) {
  return kind === "shorts" ? QUADRANT_META_SHORTS : QUADRANT_META_LONG;
}

export interface MatrixPoint {
  video: YouTubeVideo;
  ratio: number; // просмотры / медиана канала
  retention: number;
  subsPer1k: number | null; // подписчиков на 1000 просмотров
  quadrant: MatrixQuadrant;
}

// Шортс ли ролик (по длительности).
export function isShort(v: YouTubeVideo): boolean {
  const sec = durationToSeconds(v.duration);
  return sec > 0 && sec <= SHORTS_MAX_SECONDS;
}

// Раскладка роликов по матрице. Границы — медианы САМОГО канала: сравниваем ролик
// не с абстрактной нормой, а с тем, что канал обычно выдаёт.
//
// `kind` фильтрует ролики по типу и — что важнее — считает медианы ВНУТРИ типа:
// у шортсов охваты и досмотры на порядок другие, и в общей матрице они сдвигали
// медиану так, что все лонги оказывались «провалом» (и наоборот).
export function buildMatrix(
  videos: YouTubeVideo[],
  subsByVideo?: Record<string, { gained: number; lost: number }> | null,
  kind?: MatrixKind
): { points: MatrixPoint[]; medianViews: number; medianRetention: number } {
  const byKind =
    kind === undefined
      ? videos
      : videos.filter((v) => (kind === "shorts" ? isShort(v) : !isShort(v)));
  const usable = byKind.filter((v) => v.viewCount > 0 && v.avgViewPercentage != null);
  if (usable.length < 3) return { points: [], medianViews: 0, medianRetention: 0 };

  const median = (arr: number[]): number => {
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const medianViews = median(usable.map((v) => v.viewCount)) || 1;
  const medianRetention = median(usable.map((v) => v.avgViewPercentage as number));

  const points = usable.map((v) => {
    const ratio = v.viewCount / medianViews;
    const retention = v.avgViewPercentage as number;
    const wide = ratio >= 1;
    const deep = retention >= medianRetention;
    const gained = subsByVideo?.[v.id]?.gained;
    return {
      video: v,
      ratio,
      retention,
      subsPer1k: gained != null ? (gained / v.viewCount) * 1000 : null,
      quadrant: (wide ? (deep ? "works" : "bait") : deep ? "packaging" : "fail") as MatrixQuadrant,
    };
  });
  return { points, medianViews, medianRetention };
}

interface Props {
  points: MatrixPoint[];
  medianRetention: number;
  onOpenVideo: (v: YouTubeVideo) => void;
  // Тип контента, под который посчитаны точки: от него зависят подписи углов
  // («что чинить» у лонга и шортса разное).
  kind?: MatrixKind;
}

export default function PackagingMatrix({
  points,
  medianRetention,
  onOpenVideo,
  kind = "long",
}: Props) {
  const META = quadrantMeta(kind);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ p: MatrixPoint; x: number; y: number } | null>(null);
  // На телефоне точки крупнее и с широкой зоной тапа: SVG сжимается по ширине
  // экрана, и обычный r=7 из viewBox даёт на деле ~4 физических пикселя.
  const isMobile = useMediaQuery("(max-width: 48em)");
  const dotR = isMobile ? DOT_R_MOBILE : DOT_R;
  const hitR = isMobile ? DOT_HIT_MOBILE : DOT_HIT;

  // Верхняя граница удержания — по данным, но не ниже 50%, иначе точки липнут к потолку.
  const yMax = useMemo(
    () => Math.max(50, Math.ceil(Math.max(...points.map((p) => p.retention), 0) * 1.15)),
    [points]
  );

  const px = (ratio: number) => {
    const l = Math.max(-X_MAX, Math.min(X_MAX, Math.log2(ratio || 0.001)));
    return PAD.left + ((l + X_MAX) / (X_MAX * 2)) * (W - PAD.left - PAD.right);
  };
  const py = (ret: number) =>
    H - PAD.bottom - (Math.min(ret, yMax) / yMax) * (H - PAD.top - PAD.bottom);

  const midX = px(1);
  const midY = py(medianRetention);

  const track = (p: MatrixPoint) => (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ p, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  return (
    <Box ref={wrapRef} style={{ position: "relative" }} onPointerLeave={() => setHover(null)}>
      <svg
        className="pm-wrap"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Матрица роликов: охват против удержания"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {/* Заливка углов — чтобы диагноз читался до чтения подписей. */}
        <rect x={midX} y={PAD.top} width={W - PAD.right - midX} height={midY - PAD.top} className="pm-q pm-q-works" />
        <rect x={PAD.left} y={PAD.top} width={midX - PAD.left} height={midY - PAD.top} className="pm-q pm-q-packaging" />
        <rect x={midX} y={midY} width={W - PAD.right - midX} height={H - PAD.bottom - midY} className="pm-q pm-q-bait" />
        <rect x={PAD.left} y={midY} width={midX - PAD.left} height={H - PAD.bottom - midY} className="pm-q pm-q-fail" />

        {/* Оси и медианы канала */}
        <line x1={PAD.left} y1={midY} x2={W - PAD.right} y2={midY} className="pm-median" />
        <line x1={midX} y1={PAD.top} x2={midX} y2={H - PAD.bottom} className="pm-median" />

        {/* Подписи углов */}
        <text x={W - PAD.right - 8} y={PAD.top + 14} textAnchor="end" className="pm-qlabel pm-t-works">
          {META.works.label}
        </text>
        <text x={PAD.left + 8} y={PAD.top + 14} className="pm-qlabel pm-t-packaging">
          {META.packaging.label}
        </text>
        <text x={W - PAD.right - 8} y={H - PAD.bottom - 8} textAnchor="end" className="pm-qlabel pm-t-bait">
          {META.bait.label}
        </text>
        <text x={PAD.left + 8} y={H - PAD.bottom - 8} className="pm-qlabel pm-t-fail">
          {META.fail.label}
        </text>

        {/* Шкала охвата: словами, без кратностей — точная цифра есть в подсказке
            по наведению, а на оси важнее сразу понять, где «мало», а где «много». */}
        {(
          [
            [0.25, "мало"],
            [1, "как обычно"],
            [4, "много"],
          ] as const
        ).map(([ratio, label]) => (
          <text
            key={label}
            x={px(ratio)}
            y={H - PAD.bottom + 16}
            textAnchor="middle"
            className="pm-tick"
          >
            {label}
          </text>
        ))}
        {/* Шкала удержания */}
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={PAD.left - 8} y={py(yMax * f) + 4} textAnchor="end" className="pm-tick">
            {Math.round(yMax * f)}%
          </text>
        ))}
        <text x={PAD.left - 34} y={PAD.top - 10} className="pm-axis">
          досмотр
        </text>
        <text x={W - PAD.right} y={H - 4} textAnchor="end" className="pm-axis">
          просмотры
        </text>

        {points.map((p) => (
          // Две окружности на точку: видимая и НЕВИДИМАЯ мишень под палец.
          // SVG масштабируется по ширине контейнера, поэтому на телефоне точка
          // r=7 из системы координат viewBox превращается в ~4 физических
          // пикселя — попасть невозможно. Мишень (r=DOT_HIT) даёт зону тапа
          // около рекомендованных 44px, при этом визуально ничего не меняется.
          <g key={p.video.id}>
            <circle
              cx={px(p.ratio)}
              cy={py(p.retention)}
              r={dotR}
              className={`pm-dot pm-dot-${p.quadrant}`}
              // Все события — на мишени, иначе они конкурируют между собой.
              style={{ pointerEvents: "none" }}
            />
            <circle
              cx={px(p.ratio)}
              cy={py(p.retention)}
              r={hitR}
              fill="transparent"
              className="pm-hit"
              tabIndex={0}
              role="button"
              aria-label={`${p.video.title}: досмотр ${Math.round(p.retention)}%, ${formatCount(
                p.video.viewCount
              )} просмотров`}
              onPointerEnter={track(p)}
              onPointerMove={track(p)}
              onPointerLeave={() => setHover((h) => (h?.p.video.id === p.video.id ? null : h))}
              onClick={() => onOpenVideo(p.video)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenVideo(p.video);
                }
              }}
            />
          </g>
        ))}
      </svg>

      {hover && (
        <Box
          className="pm-tip"
          style={{
            left: hover.x,
            top: hover.y,
            transform: `translate(${
              hover.x > (wrapRef.current?.clientWidth ?? 0) - 250 ? "calc(-100% - 14px)" : "14px"
            }, ${hover.y > (wrapRef.current?.clientHeight ?? 0) - 140 ? "calc(-100% - 10px)" : "10px"})`,
          }}
        >
          <Group gap={8} wrap="nowrap" align="flex-start">
            {hover.p.video.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={hover.p.video.thumbnail}
                alt=""
                style={{ width: 72, aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 6 }}
              />
            )}
            <Box style={{ minWidth: 0 }}>
              <Text size="xs" fw={600} lineClamp={2}>
                {hover.p.video.title}
              </Text>
              <Text size="xs" c="dimmed">
                {formatDate(hover.p.video.publishedAt)}
              </Text>
            </Box>
          </Group>
          <Box mt={6}>
            <Text size="xs">
              {formatCount(hover.p.video.viewCount)} просмотров ·{" "}
              {hover.p.ratio >= 1
                ? `в ${hover.p.ratio.toFixed(1)} раза больше обычного`
                : `в ${(1 / hover.p.ratio).toFixed(1)} раза меньше обычного`}
            </Text>
            <Text size="xs">Досмотр {Math.round(hover.p.retention)}%</Text>
            {hover.p.subsPer1k != null && (
              <Text size="xs">
                {hover.p.subsPer1k.toFixed(1)} подписчиков на 1000 просмотров
              </Text>
            )}
          </Box>
          <Text size="xs" c="dimmed" mt={6}>
            {META[hover.p.quadrant].hint}
          </Text>
        </Box>
      )}
    </Box>
  );
}
