import {
  IconCalendar,
  IconCalendarMonth,
  IconChartLine,
  IconClick,
  IconFlame,
  IconFolder,
  IconHeart,
  IconMessage,
  IconMessages,
  IconPhoto,
  IconPlugConnected,
  IconRadar,
  IconRoute,
  IconSearch,
  IconSeo,
  IconUser,
  IconUserPlus,
  type IconProps,
} from "@tabler/icons-react";
import type { AchievementIcon } from "@/lib/achievements";
import type { ComponentType } from "react";

// Маппинг «имя иконки из каталога → компонент Tabler». Держим ОТДЕЛЬНО от чистого
// модуля achievements.ts, чтобы тот можно было импортировать на сервере (без React).
const MAP: Record<AchievementIcon, ComponentType<IconProps>> = {
  message: IconMessage,
  messages: IconMessages,
  folder: IconFolder,
  photo: IconPhoto,
  radar: IconRadar,
  search: IconSearch,
  plug: IconPlugConnected,
  user: IconUser,
  flame: IconFlame,
  calendar: IconCalendar,
  seo: IconSeo,
  click: IconClick,
  userPlus: IconUserPlus,
  heart: IconHeart,
  chart: IconChartLine,
  route: IconRoute,
  calendarMonth: IconCalendarMonth,
};

export function AchIcon({ name, ...props }: { name: AchievementIcon } & IconProps) {
  const Cmp = MAP[name] ?? IconMessage;
  return <Cmp {...props} />;
}
