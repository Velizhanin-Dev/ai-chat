"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  /** Задержка появления, мс — для каскада соседних блоков. */
  delay?: number;
  /** Тянуть на всю высоту/ширину родителя (для grid-ячеек). */
  fill?: boolean;
};

/**
 * Лёгкая обёртка «появление при скролле» на IntersectionObserver.
 * Анимация полностью отключается при prefers-reduced-motion (см. globals.css).
 */
export default function Reveal({ children, delay = 0, fill = false }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="lp-reveal"
      data-visible={visible}
      style={{
        transitionDelay: `${delay}ms`,
        height: fill ? "100%" : undefined,
      }}
    >
      {children}
    </div>
  );
}
