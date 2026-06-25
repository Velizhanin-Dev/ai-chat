"use client";

import { useEffect, useState } from "react";

// Обратный отсчёт «до запуска AI-ассистента» в герое лендинга (pre-launch,
// см. settings.launch). Время считаем на клиенте: до маунта — статичные прочерки
// (без hydration mismatch), затем тикаем раз в секунду.
//
// Фишка: крупные бренд-цифры катятся «одометром» (каждая цифра — вертикальная
// лента 0–9, сдвигается transform'ом при смене), живая пульсирующая точка и
// дышащее акцентное свечение за цифрами. Всё на transform/opacity, с уважением
// к prefers-reduced-motion (см. .lc* в globals.css).

interface Parts {
  d: number;
  h: number;
  m: number;
  s: number;
  done: boolean;
}

function partsTo(target: number): Parts {
  const ms = Math.max(0, target - Date.now());
  const total = Math.floor(ms / 1000);
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
    done: ms === 0,
  };
}

// Одна цифра-«барабан»: лента 0–9, сдвиг по вертикали = текущее значение.
// null → статичный прочерк (до гидратации).
function Digit({ d }: { d: number | null }) {
  if (d === null) {
    return <span className="lc-digit lc-digit--ph">–</span>;
  }
  return (
    <span className="lc-digit">
      <span className="lc-digit__roll" style={{ transform: `translateY(-${d * 10}%)` }}>
        {Array.from({ length: 10 }, (_, n) => (
          <span key={n}>{n}</span>
        ))}
      </span>
    </span>
  );
}

// Группа из двух цифр (дни/часы/минуты/секунды) + подпись.
function Group({ value, label }: { value: number | null; label: string }) {
  // Дни теоретически могут быть >99 — тогда показываем как есть (без барабана),
  // но для near-term запуска это всегда 2 цифры.
  const tens = value === null ? null : Math.floor(value / 10) % 10;
  const ones = value === null ? null : value % 10;
  return (
    <div className="lc-group">
      <div className="lc-digits">
        <Digit d={tens} />
        <Digit d={ones} />
      </div>
      <span className="lc-label">{label}</span>
    </div>
  );
}

export default function LaunchCountdown({ targetAt }: { targetAt: string }) {
  const target = new Date(targetAt).getTime();
  const [t, setT] = useState<Parts | null>(null);

  useEffect(() => {
    setT(partsTo(target));
    const id = setInterval(() => setT(partsTo(target)), 1000);
    return () => clearInterval(id);
  }, [target]);

  const done = t?.done ?? false;

  // Текст для скринридеров (без секунд — чтобы не «тарахтело»). aria-live не
  // ставим: цифры обновляются ежесекундно, озвучивать каждую не нужно.
  const sr = done
    ? "AI-ассистент запущен"
    : t
    ? `До запуска: ${t.d} дн ${t.h} ч ${t.m} мин`
    : "Идёт обратный отсчёт до запуска";

  return (
    <div className="lc" role="timer">
      <span className="lc-sr">{sr}</span>

      <div className="lc-eyebrow">
        <span className="lc-dot" aria-hidden />
        <span className="lc-eyebrow-text">
          {done ? "Запускаемся" : "До запуска осталось"}
        </span>
      </div>

      {done ? (
        <div className="lc-done">Велижанин AI — в эфире</div>
      ) : (
        <>
          <div className="lc-clock" aria-hidden>
            <Group value={t ? t.d : null} label="дней" />
            <span className="lc-sep">:</span>
            <Group value={t ? t.h : null} label="часов" />
            <span className="lc-sep">:</span>
            <Group value={t ? t.m : null} label="минут" />
            <span className="lc-sep">:</span>
            <Group value={t ? t.s : null} label="секунд" />
          </div>
          <div className="lc-caption">
            Собираем ассистента по методике Николая Велижанина
          </div>
        </>
      )}
    </div>
  );
}
