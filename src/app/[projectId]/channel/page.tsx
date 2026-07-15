import ChannelDashboard from "@/components/Channel/ChannelDashboard";

// Раздел «Канал»: дашборд подключённого YouTube-канала (статистика, динамика
// просмотров, последние видео). Подключение — в настройках проекта. Доступен всем
// залогиненным (гость → middleware на /login); данные — только если канал подключён.
export default function ChannelPage() {
  return <ChannelDashboard />;
}
