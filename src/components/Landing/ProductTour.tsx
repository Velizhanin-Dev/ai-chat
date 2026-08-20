"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Group, List, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import {
  IconChartHistogram,
  IconLayoutKanban,
  IconMessageChatbot,
  IconPhotoAi,
  IconRoute,
  IconSearch,
  IconUsers,
} from "@tabler/icons-react";
import Section from "./Section";
import SectionHeading from "./SectionHeading";

// ── Тур по продукту: 2.5D-сцены вместо карточек ─────────────────────────────
//
// Заменил прежний блок «Рабочий кабинет» (четыре плоские карточки): он перечислял
// разделы, но не показывал, ЧТО человек увидит и как это доводит его до готового
// ролика. Здесь каждая функция — сцена: слева объяснение «зачем и что это даёт»,
// справа собранный из UI-элементов макет в изометрии.
//
// ⚠️ Скриншотов по-прежнему нет, и пустых рамок-заглушек мы не ставим (см. CLAUDE.md).
// Макеты собраны из настоящих токенов темы — это не картинки, поэтому они живут в
// обеих темах и не устаревают при смене скриншота.
//
// Правила движения (UI/UX: motion-meaning, transform-performance, stagger-sequence):
//  • анимируем только transform/opacity, 320–420 мс, ease-out;
//  • сцена «встаёт» из глубины один раз при появлении — это про причину и следствие
//    (пришёл раздел → развернулся), а не украшение;
//  • слои внутри сцены появляются каскадом по 60 мс;
//  • prefers-reduced-motion выключает и наклон, и каскад (см. globals.css).

interface Scene {
  key: string;
  icon: React.ReactNode;
  step: string;
  title: string;
  lead: string;
  points: string[];
  visual: React.ReactNode;
}

// Наклон сцены задаём data-атрибутом, а не инлайном: так один CSS-класс держит и
// обычное состояние, и reduced-motion, и мобильную (фронтальную) раскладку.
function Stage({ children, flip }: { children: React.ReactNode; flip?: boolean }) {
  return (
    <Box className="tour-stage" data-flip={flip ? "true" : undefined}>
      <Box className="tour-stage-inner">{children}</Box>
    </Box>
  );
}

function Layer({ children, i = 0, className }: { children: React.ReactNode; i?: number; className?: string }) {
  return (
    <Box className={`tour-layer${className ? ` ${className}` : ""}`} style={{ "--i": i } as React.CSSProperties}>
      {children}
    </Box>
  );
}

// ── Макеты разделов ─────────────────────────────────────────────────────────

function ChatVisual() {
  return (
    <Stage>
      <Layer i={0}>
        <Box className="tour-card tour-chat">
          <Box className="tour-bubble tour-bubble-user">Сценарий на 12 минут про ошибки в ремонте</Box>
          <Box className="tour-bubble tour-bubble-ai">
            <span className="tour-line" style={{ width: "92%" }} />
            <span className="tour-line" style={{ width: "78%" }} />
            <span className="tour-line" style={{ width: "85%" }} />
          </Box>
        </Box>
      </Layer>
      <Layer i={1} className="tour-float tour-float-a">
        <Box className="tour-chip">
          <span className="tour-dot" /> хук на первые 5 секунд
        </Box>
      </Layer>
      <Layer i={2} className="tour-float tour-float-b">
        <Box className="tour-quote">
          «Ты каждый день делаешь это — и сам режешь себе охваты»
        </Box>
      </Layer>
    </Stage>
  );
}

function PlanVisual() {
  const cols = [
    { label: "Идея", n: 4, tone: "gray" },
    { label: "В работе", n: 2, tone: "brand" },
    { label: "Вышло", n: 3, tone: "teal" },
  ];
  return (
    <Stage flip>
      <Layer i={0}>
        <Box className="tour-card tour-board">
          {cols.map((c, ci) => (
            <Box key={c.label} className="tour-col">
              <Box className="tour-col-head">
                <span className={`tour-dot tour-dot-${c.tone}`} />
                {c.label}
              </Box>
              {Array.from({ length: c.n }).map((_, i) => (
                <Box key={i} className="tour-mini" data-accent={ci === 1 && i === 0 ? "true" : undefined}>
                  <span className="tour-line" style={{ width: i % 2 ? "72%" : "88%" }} />
                  <span className="tour-visp">В И С П</span>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Layer>
      <Layer i={1} className="tour-float tour-float-c">
        <Box className="tour-chip">8 роликов + 16 шортсов</Box>
      </Layer>
    </Stage>
  );
}

function AnalyticsVisual() {
  // Точки матрицы «упаковка ↔ содержание»: координаты подобраны так, чтобы читались
  // все четыре угла — в том числе «кликнули и ушли» (правый низ) и провал.
  const dots = [
    { x: 74, y: 26, tone: "teal" },
    { x: 62, y: 38, tone: "teal" },
    { x: 30, y: 30, tone: "brand" },
    { x: 22, y: 44, tone: "brand" },
    { x: 78, y: 72, tone: "red" },
    { x: 66, y: 80, tone: "red" },
    { x: 26, y: 74, tone: "gray" },
  ];
  return (
    <Stage>
      <Layer i={0}>
        <Box className="tour-card tour-matrix">
          <span className="tour-axis tour-axis-x" />
          <span className="tour-axis tour-axis-y" />
          {dots.map((d, i) => (
            <span
              key={i}
              className={`tour-point tour-dot-${d.tone}`}
              style={{ left: `${d.x}%`, top: `${d.y}%`, animationDelay: `${300 + i * 45}ms` }}
            />
          ))}
          <span className="tour-quad tour-quad-tl">слабая упаковка</span>
          <span className="tour-quad tour-quad-tr">работает</span>
          <span className="tour-quad tour-quad-br">кликнули и ушли</span>
        </Box>
      </Layer>
      <Layer i={1} className="tour-float tour-float-a">
        <Box className="tour-chip">
          <span className="tour-dot tour-dot-red" /> 3 ролика в очередь на переделку
        </Box>
      </Layer>
    </Stage>
  );
}

function ThumbVisual() {
  return (
    <Stage flip>
      <Layer i={0}>
        <Box className="tour-card tour-thumb">
          <Box className="tour-thumb-img">
            <span className="tour-thumb-text">ДЕНЬГИ УХОДЯТ</span>
            <span className="tour-thumb-arrow" />
          </Box>
          <Box className="tour-thumb-meta">
            <span className="tour-line" style={{ width: "84%" }} />
            <span className="tour-line" style={{ width: "46%" }} />
          </Box>
        </Box>
      </Layer>
      <Layer i={1} className="tour-float tour-float-b">
        <Box className="tour-chip">текст не дублирует название</Box>
      </Layer>
    </Stage>
  );
}

function CompetitorsVisual() {
  const rows = [
    { r: "×7,4", w: 86, hot: true },
    { r: "×2,1", w: 64 },
    { r: "×4,8", w: 74, hot: true },
  ];
  return (
    <Stage>
      <Layer i={0}>
        <Box className="tour-card tour-list">
          {rows.map((row, i) => (
            <Box key={i} className="tour-row">
              <span className="tour-avatar" />
              <span className="tour-line" style={{ width: `${row.w}%` }} />
              <span className={`tour-ratio${row.hot ? " tour-ratio-hot" : ""}`}>{row.r}</span>
            </Box>
          ))}
        </Box>
      </Layer>
      <Layer i={1} className="tour-float tour-float-c">
        <Box className="tour-chip">
          <span className="tour-dot tour-dot-brand" /> у конкурента залетело — в телеграм
        </Box>
      </Layer>
    </Stage>
  );
}

function ReferencesVisual() {
  return (
    <Stage flip>
      <Layer i={0}>
        <Box className="tour-card tour-grid">
          {[0, 1, 2, 3].map((i) => (
            <Box key={i} className="tour-tile" data-accent={i === 1 ? "true" : undefined}>
              <span className="tour-tile-badge">{["×3,2", "×12", "×5,6", "×4,1"][i]}</span>
              <span className="tour-line" style={{ width: i % 2 ? "70%" : "88%" }} />
            </Box>
          ))}
        </Box>
      </Layer>
      <Layer i={1} className="tour-float tour-float-a">
        <Box className="tour-chip">→ референсом в карточку плана</Box>
      </Layer>
    </Stage>
  );
}

function RoadmapVisual() {
  const steps = ["SEO и описание", "Превью и CTR", "Конверсия в подписку", "Удержание"];
  return (
    <Stage>
      <Layer i={0}>
        <Box className="tour-card tour-steps">
          {steps.map((s, i) => (
            <Box key={s} className="tour-step" data-done={i < 2 ? "true" : undefined}>
              <span className="tour-step-mark" />
              <span>{s}</span>
            </Box>
          ))}
        </Box>
      </Layer>
      <Layer i={1} className="tour-float tour-float-b">
        <Box className="tour-chip">серия 6 дней</Box>
      </Layer>
    </Stage>
  );
}

// ── Содержание тура ─────────────────────────────────────────────────────────
//
// Формулировки отвечают на один вопрос: как раздел доводит до готового ролика.
const SCENES: Scene[] = [
  {
    key: "chat",
    icon: <IconMessageChatbot size={20} />,
    step: "Сценарий",
    title: "Ассистент, который пишет как Николай",
    lead:
      "Просите сценарий, хук, название или разбор — получаете готовый артефакт, а не совет «подумайте над структурой». Внутри методика КМК: заход, усугубление, призывы по хронометражу.",
    points: [
      "Сценарий целиком: от первых пяти секунд до финала",
      "Кнопка «только сценарий» копирует то, что произносят в кадре",
      "Помнит ваш канал, нишу и тип харизмы — не спрашивает заново",
    ],
    visual: <ChatVisual />,
  },
  {
    key: "plan",
    icon: <IconLayoutKanban size={20} />,
    step: "План",
    title: "Контент-план на месяц, а не список тем",
    lead:
      "Восемь длинных роликов и шестнадцать шортсов за одну сборку. У каждой карточки название, текст на превью, боль аудитории и скелет из десяти вопросов — по нему сценарий пишется за один заход.",
    points: [
      "Доска по статусам: идея → в работе → вышло",
      "Портреты аудитории и лестница Ханта собираются следом",
      "Вышедший ролик связывается с каналом и подтягивает просмотры",
    ],
    visual: <PlanVisual />,
  },
  {
    key: "analytics",
    icon: <IconChartHistogram size={20} />,
    step: "Диагноз",
    title: "Аналитика отвечает, что чинить",
    lead:
      "Не пересказ Studio. Матрица «упаковка ↔ содержание» показывает, где потеряли зрителя: не кликнули, кликнули и ушли или досмотрели, но не подписались — и с какого ролика начинать.",
    points: [
      "Разбор канала по семи параметрам продвижения",
      "Отдельно лонги, отдельно шортсы — у них разные законы",
      "Очередь на переделку: три ролика, где вернуть охваты дешевле всего",
    ],
    visual: <AnalyticsVisual />,
  },
  {
    key: "thumbs",
    icon: <IconPhotoAi size={20} />,
    step: "Упаковка",
    title: "Превью по методике студии",
    lead:
      "Одна идея в кадре, три разных масштаба против баннерной слепоты, текст, который не повторяет название. Лицо переносится с вашего фото, результат сразу показан карточкой в ленте YouTube.",
    points: [
      "Пять раскладок кадра — от строгой до «щас покажу»",
      "Названия и текст на превью по ВИСП на выбор",
      "Видно, как обложка смотрится рядом с названием",
    ],
    visual: <ThumbVisual />,
  },
  {
    key: "competitors",
    icon: <IconUsers size={20} />,
    step: "Ниша",
    title: "Конкуренты под присмотром",
    lead:
      "Свой список каналов ниши: что у них выходит, сколько собирает и во сколько раз это больше их обычного. Залетевший ролик прилетает в телеграм — вы узнаёте о тренде, пока он ещё тренд.",
    points: [
      "Свежие ролики каждого канала с кратностью и типом",
      "Кто в нише растёт, а кто стоит — по нашим замерам",
      "Уведомление, когда у конкурента ролик вылетел за аудиторию",
    ],
    visual: <CompetitorsVisual />,
  },
  {
    key: "references",
    icon: <IconSearch size={20} />,
    step: "Референсы",
    title: "Поиск того, что уже выстрелило",
    lead:
      "Ищем в нише ролики, у которых просмотров кратно больше, чем у канала подписчиков: такие взлетели на упаковке, а не на базе. Ассистент разбирает их по описанию и реакции зрителей.",
    points: [
      "Сортировка по кратности, а не по абсолютным просмотрам",
      "Любой ролик кладётся референсом в карточку плана",
      "Разбор упаковки: какие заходы работают в вашей нише",
    ],
    visual: <ReferencesVisual />,
  },
  {
    key: "roadmap",
    icon: <IconRoute size={20} />,
    step: "Ритм",
    title: "Дорожная карта и достижения",
    lead:
      "Шаги подбираются по цифрам вашего канала и открываются по одному — чтобы вы делали одно дело за раз. Выполнение проверяется новым разбором, а не галочкой.",
    points: [
      "Пять шагов: SEO, превью, подписка, вовлечение, удержание",
      "Проверка по факту: проблема ушла — шаг закрыт",
      "Серии и медали за реальные действия, а не за вход",
    ],
    visual: <RoadmapVisual />,
  },
];

// Появление сцены: один раз, при пересечении. Тот же приём, что у Reveal, но
// сцене нужно знать о видимости самой (каскад слоёв и наклон), поэтому свой хук.
function useOnScreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, seen };
}

function SceneRow({ scene, index }: { scene: Scene; index: number }) {
  const { ref, seen } = useOnScreen<HTMLDivElement>();
  const flip = index % 2 === 1;

  return (
    <Box ref={ref} className="tour-scene" data-visible={seen} data-flip={flip ? "true" : undefined}>
      {/* Рельс с точкой: связывает сцены в один маршрут и показывает, где мы. */}
      <Box className="tour-rail" aria-hidden>
        <span className="tour-rail-dot" />
      </Box>

      <Box className="tour-copy">
        <Group gap="sm" mb="sm" wrap="nowrap">
          <ThemeIcon size={38} radius="md" variant="light" color="brand">
            {scene.icon}
          </ThemeIcon>
          <Text fw={600} size="sm" style={{ color: "var(--color-accent)" }}>
            {scene.step}
          </Text>
        </Group>

        <Title order={3} fz={{ base: "1.35rem", sm: "1.6rem" }} lh={1.2} mb="xs">
          {scene.title}
        </Title>

        {/* ⚠️ Описание НЕ c="dimmed": на этой подложке приглушённый токен даёт ~4:1,
            ниже нормы 4.5:1 (те же грабли ловили в блоке «Рабочий кабинет»). */}
        <Text style={{ maxWidth: "58ch" }}>{scene.lead}</Text>

        <List spacing={6} mt="md" size="sm" listStyleType="none">
          {scene.points.map((p) => (
            <List.Item key={p}>
              <Group gap={8} wrap="nowrap" align="flex-start">
                <span className="tour-tick" aria-hidden />
                <Text size="sm">{p}</Text>
              </Group>
            </List.Item>
          ))}
        </List>
      </Box>

      <Box className="tour-visual">{scene.visual}</Box>
    </Box>
  );
}

export default function ProductTour() {
  return (
    <Section id="workspace" alt>
      <SectionHeading
        eyebrow="как это собирается"
        title="От вопроса в чате до вышедшего ролика"
        subtitle="Семь разделов, которые ведут один ролик по всему пути: придумать, упаковать, снять, проверить цифрами и повторить."
      />

      <Stack gap={0} mt="xl">
        {SCENES.map((s, i) => (
          <SceneRow key={s.key} scene={s} index={i} />
        ))}
      </Stack>
    </Section>
  );
}
