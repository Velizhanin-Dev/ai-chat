"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActionIcon, Box, Button, Group, ScrollArea } from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useAppDispatch } from "@/store/hooks";
import { prefillInput } from "@/store/chatSlice";
import { SUGGESTIONS } from "./suggestions";

// Лента быстрых действий НАД полем ввода: те же готовые запросы, что на пустом
// экране чата (общий список ./suggestions), но компактными чипами в одну строку
// с горизонтальным скроллом. Нужна, когда переписка уже началась и стартовый
// экран не показывается — иначе функционал становится недоступен после первого
// сообщения. Клик подставляет текст в композер (prefillInput).
//
// Скролл — на Mantine ScrollArea (type="never": полосу прячем, ездим стрелками,
// свайпом и колесом), как горизонтальная лента вкладок в TopNav. Чипы — обычные
// Button variant="default" radius="xl".

// Насколько прокручиваем за одно нажатие стрелки — доля видимой ширины.
const STEP_RATIO = 0.8;
// Боковые отступы ленты: широкие — место под стрелки, узкие — когда стрелок нет
// (иначе лента висит с пустыми полями по краям).
const PAD_WITH_ARROWS = 34;
const PAD_PLAIN = 4;

export default function QuickActions() {
  const dispatch = useAppDispatch();
  const viewport = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  // Не влезает ли лента в ширину — от этого зависят и стрелки, и отступы.
  const [overflows, setOverflows] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = viewport.current;
    const content = row.current;
    if (!el || !content) return;
    // Ширину контента меряем по САМОМУ ряду чипов, а не по scrollWidth вьюпорта:
    // scrollWidth включает padding, который сам зависит от наличия стрелок —
    // получилась бы петля «появилась стрелка → шире padding → влезло → стрелка
    // исчезла → …». По ширине ряда решение стабильно.
    const over = content.scrollWidth > el.clientWidth - PAD_PLAIN * 2;
    setOverflows(over);
    // 1px допуска: subpixel-ширины дают дробный остаток и «вечно активную» стрелку.
    setCanLeft(over && el.scrollLeft > 1);
    setCanRight(over && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    update();
    const el = viewport.current;
    if (!el) return;
    // Ширина меняется и при сворачивании сайдбара, не только окна.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);

  // Колесо мыши и вертикальный жест тачпада тоже листают ленту вбок: над узкой
  // горизонтальной лентой вертикальная прокрутка бесполезна, а привычка «кручу
  // колесо — едет» сильная. Горизонтальный жест (deltaX) не трогаем — его
  // браузер отрабатывает сам. Слушатель вешаем вручную: React-овый onWheel
  // пассивный, из него preventDefault не сработает.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // жест уже горизонтальный
      if (el.scrollWidth <= el.clientWidth) return; // скроллить нечего
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const scrollStep = (dir: -1 | 1) => {
    const el = viewport.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * STEP_RATIO, behavior: "smooth" });
  };

  // Отступ считаем ПОСТОРОННЕ для каждого края: место резервируем только там,
  // где стрелка реально видна. Раньше отступ вешался по факту переполнения — и
  // слева зияла пустота, пока лента стоит в начале и левой стрелки ещё нет.
  const padLeft = canLeft ? PAD_WITH_ARROWS : PAD_PLAIN;
  const padRight = canRight ? PAD_WITH_ARROWS : PAD_PLAIN;

  return (
    <Box pos="relative" mb="xs" style={{ flexShrink: 0, minWidth: 0 }}>
      {/* Позиционирует ОБЁРТКА, а не сама кнопка: у Mantine ActionIcon есть
          :active { transform: translateY(...) }, который затирал наш
          translateY(-50%) — на нажатии стрелка проваливалась вниз. */}
      {canLeft && (
        <Box className="qa-arrow" style={{ left: 0 }}>
          <ActionIcon
            variant="default"
            radius="xl"
            size="md"
            aria-label="Прокрутить влево"
            onClick={() => scrollStep(-1)}
          >
            <IconChevronLeft size={16} />
          </ActionIcon>
        </Box>
      )}

      <ScrollArea
        type="never"
        scrollbars="x"
        viewportRef={viewport}
        onScrollPositionChange={update}
      >
        {/* nowrap обязателен: с переносом горизонтального overflow не будет
            вовсе и лента перестанет скроллиться. */}
        <Group ref={row} gap="xs" wrap="nowrap" pl={padLeft} pr={padRight} py={2}>
          {SUGGESTIONS.map((s) => (
            <Button
              key={s.title}
              variant="default"
              radius="xl"
              size="sm"
              leftSection={
                <Box c="brand" style={{ display: "flex" }}>
                  {s.icon}
                </Box>
              }
              onClick={() => dispatch(prefillInput(s.prompt))}
              style={{ flexShrink: 0 }}
            >
              {s.title}
            </Button>
          ))}
        </Group>
      </ScrollArea>

      {canRight && (
        <Box className="qa-arrow" style={{ right: 0 }}>
          <ActionIcon
            variant="default"
            radius="xl"
            size="md"
            aria-label="Прокрутить вправо"
            onClick={() => scrollStep(1)}
          >
            <IconChevronRight size={16} />
          </ActionIcon>
        </Box>
      )}
    </Box>
  );
}
