"use client";

import { useProjectPlatform } from "@/hooks/useProjectPlatform";
import ChannelDashboard from "./ChannelDashboard";
import InstagramDashboard from "./InstagramDashboard";

// Развилка раздела «Аналитика» по площадке проекта.
//
// ⚠️ Дашборды РАЗНЫЕ, а не один с ветвлениями внутри: у YouTube матрица «упаковка ↔
// содержание», удержание по кривой и разбор по 7 параметрам; у Instagram — пропуски,
// среднее время и вовлечение, потому что кривой удержания и источников трафика
// Graph API не отдаёт вовсе. Пытаться свести их в один экран — значит половину
// показателей рисовать пустыми.
export default function ChannelAnalytics() {
  const { platform } = useProjectPlatform();
  return platform === "instagram" ? <InstagramDashboard /> : <ChannelDashboard />;
}
