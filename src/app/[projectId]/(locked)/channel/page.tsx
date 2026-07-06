import ChannelDashboard from "@/components/Channel/ChannelDashboard";

// Раздел «Канал»: дашборд подключённого YouTube-канала (статистика, динамика
// просмотров, последние видео). Подключение — в настройках («Интеграции»).
// Доступ пока гейтит (locked)/layout (только админам) — см. дорожную карту.
export default function ChannelPage() {
  return <ChannelDashboard />;
}
