"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ParamSpec } from "@/lib/channel-params";
import type { ParamVerdict } from "@/lib/youtube-types";

// Круг разбора канала: один сектор на параметр, заполнение растёт ИЗ ЦЕНТРА
// наружу пропорционально баллу 0-100. Чистый SVG, без чарт-библиотек.
//
// Почему рост анимируем пересчётом пути, а не CSS-transform: у SVG-групп
// transform-origin ведёт себя по-разному в браузерах (та же семья проблем, что
// ловили на старом Safari) — интерполяция радиуса надёжна везде и даёт ровно тот
// эффект «наливается из центра», который нужен.

const VIEW = 340; // сторона квадрата с кругом (user units)
const CX = VIEW / 2;
const CY = VIEW / 2;
const R_INNER = 46; // ядро с общим баллом
const R_OUTER = 152;
const GAP_DEG = 2.2; // зазор между секторами
const GROW_MS = 520;

export function verdictColor(verdict: ParamVerdict["verdict"]): string {
  return verdict === "good" ? "teal" : verdict === "bad" ? "red" : "brand";
}
function fillVar(verdict: ParamVerdict["verdict"], selected: boolean): string {
  const c = verdictColor(verdict);
  return `var(--mantine-color-${c}-${selected ? 7 : 5})`;
}

function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
}

// Кольцевой сектор от радиуса r0 до r1 между углами a0..a1 (градусы, 0 = вверх).
function wedge(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
}

// Прогресс анимации 0→1 (ease-out). При prefers-reduced-motion — сразу 1.
function useGrow(key: string): number {
  const [k, setK] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setK(1);
      return;
    }
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / GROW_MS);
      // easeOutCubic — быстро выезжает, мягко останавливается.
      setK(1 - Math.pow(1 - p, 3));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    setK(0);
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [key]);
  return k;
}

interface Props {
  params: ParamVerdict[];
  specs: ParamSpec[];
  overall: number;
  selected: string | null;
  onSelect: (key: string) => void;
  // Измеренные значения параметров (key → «34 %») для тултипа.
  values?: Record<string, string>;
  // Подписи параметров вокруг круга (на узких экранах их место — в легенде).
  withLabels?: boolean;
  // Ключ, смена которого перезапускает анимацию (id разбора).
  animKey?: string;
}

// Что показываем в тултипе наведённого сектора.
interface TipState {
  key: string;
  x: number;
  y: number;
}

export default function ParamWheel({
  params,
  specs,
  overall,
  selected,
  onSelect,
  values,
  withLabels = true,
  animKey = "",
}: Props) {
  const k = useGrow(animKey);
  const specByKey = useMemo(() => new Map(specs.map((s) => [s.key, s])), [specs]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);

  const step = 360 / params.length;
  // Запас по краям под подписи; без подписей рисуем плотно. padY=34 — под три
  // строки подписи нижнего сектора (при 26 её последняя строка обрезалась).
  const padX = withLabels ? 100 : 6;
  const padY = withLabels ? 34 : 6;
  const viewBox = `${-padX} ${-padY} ${VIEW + padX * 2} ${VIEW + padY * 2}`;

  // Позиция тултипа — в координатах обёртки. Тач/перо игнорируем: там подсказка
  // не нужна (палец закрывает круг), работает обычный тап по сектору.
  const track = (key: string) => (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ key, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const tipParam = tip ? params.find((p) => p.key === tip.key) ?? null : null;
  const tipSpec = tipParam ? specByKey.get(tipParam.key) : null;

  return (
    <div ref={wrapRef} style={{ position: "relative" }} onPointerLeave={() => setTip(null)}>
    <svg
      className="pw-wrap"
      viewBox={viewBox}
      role="img"
      aria-label={`Круг разбора канала, общий балл ${overall} из 100`}
      style={{ width: "100%", height: "auto", maxWidth: withLabels ? 540 : 340, display: "block" }}
    >
      {/* Ориентиры 25/50/75/100 — чтобы «наполовину» читалось глазом, а не только цветом. */}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle
          key={f}
          cx={CX}
          cy={CY}
          r={R_INNER + (R_OUTER - R_INNER) * f}
          fill="none"
          stroke="var(--pw-grid)"
          strokeWidth={1}
          strokeDasharray={f === 1 ? undefined : "3 5"}
        />
      ))}

      {params.map((p, i) => {
        const spec = specByKey.get(p.key);
        const a0 = i * step + GAP_DEG / 2;
        const a1 = (i + 1) * step - GAP_DEG / 2;
        const mid = (a0 + a1) / 2;
        const rFull = R_INNER + (R_OUTER - R_INNER) * (p.score / 100);
        const r = R_INNER + (rFull - R_INNER) * k;
        const isSel = selected === p.key;
        const label = spec?.short ?? p.key;
        const [lx, ly] = polar(R_OUTER + 16, mid);
        const anchor = Math.abs(mid % 360) < 8 || Math.abs((mid % 360) - 180) < 8
          ? "middle"
          : mid % 360 < 180
            ? "start"
            : "end";

        return (
          <g key={p.key} className={`pw-sector${isSel ? " pw-sector-sel" : ""}`}>
            {/* Трек сектора: докуда мог бы дорасти балл. */}
            <path d={wedge(R_INNER, R_OUTER, a0, a1)} fill="var(--pw-track)" />
            {/* Заполнение. Минимальный видимый корешок даже при нуле — иначе сектор
                «пропадает» и не по чему кликнуть. */}
            <path
              d={wedge(R_INNER, Math.max(R_INNER + 3, r), a0, a1)}
              fill={fillVar(p.verdict, isSel)}
            />
            {/* Кликабельная зона — весь сектор целиком, а не только залитая часть. */}
            <path
              d={wedge(R_INNER, R_OUTER, a0, a1)}
              fill="transparent"
              className="pw-hit"
              tabIndex={0}
              role="button"
              aria-label={`${spec?.label ?? p.key}: ${p.score} из 100`}
              aria-pressed={isSel}
              onPointerEnter={track(p.key)}
              onPointerMove={track(p.key)}
              onPointerLeave={() => setTip((t) => (t?.key === p.key ? null : t))}
              onClick={() => onSelect(p.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(p.key);
                }
              }}
            />
            {withLabels && (
              <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                dominantBaseline="middle"
                className={`pw-label${isSel ? " pw-label-sel" : ""}`}
                onClick={() => onSelect(p.key)}
              >
                <tspan x={lx} dy={label.includes(" ") ? "-0.4em" : 0}>
                  {label.split(" ")[0]}
                </tspan>
                {label.includes(" ") && (
                  <tspan x={lx} dy="1.15em">
                    {label.split(" ").slice(1).join(" ")}
                  </tspan>
                )}
                <tspan x={lx} dy="1.2em" className="pw-label-score">
                  {p.score}
                </tspan>
              </text>
            )}
          </g>
        );
      })}

      {/* Ядро: общий балл канала. */}
      <circle cx={CX} cy={CY} r={R_INNER - 4} fill="var(--pw-core)" />
      <text x={CX} y={CY - 6} textAnchor="middle" dominantBaseline="middle" className="pw-overall">
        {Math.round(overall * k)}
      </text>
      <text x={CX} y={CY + 16} textAnchor="middle" dominantBaseline="middle" className="pw-overall-cap">
        из 100
      </text>
    </svg>

      {tip && tipParam && (
        <div
          className="pw-tip"
          style={{
            left: tip.x,
            top: tip.y,
            // Тултип у правого/нижнего края переворачиваем к курсору, чтобы не
            // вылезал за модалку.
            transform: `translate(${
              tip.x > (wrapRef.current?.clientWidth ?? 0) - 260 ? "calc(-100% - 14px)" : "14px"
            }, ${tip.y > (wrapRef.current?.clientHeight ?? 0) - 150 ? "calc(-100% - 10px)" : "10px"})`,
          }}
        >
          <div className="pw-tip-head">
            <span className="pw-tip-title">{tipSpec?.label ?? tipParam.key}</span>
            <span className={`pw-tip-badge pw-tip-${tipParam.verdict}`}>{tipParam.score}</span>
          </div>
          <div className="pw-tip-value">{values?.[tipParam.key] ?? "нет данных"}</div>
          {tipSpec?.norm && <div className="pw-tip-norm">Норма: {tipSpec.norm}</div>}
          {tipParam.fact && <div className="pw-tip-fact">{tipParam.fact}</div>}
          {tipSpec?.about && <div className="pw-tip-about">{tipSpec.about}</div>}
          <div className="pw-tip-hint">Нажми — покажу, что с этим делать</div>
        </div>
      )}
    </div>
  );
}
