import ChannelAnalytics from "@/components/Channel/ChannelAnalytics";

// Раздел «Аналитика»: дашборд подключённого аккаунта. Какой именно — решает
// площадка проекта (YouTube или Instagram), см. ChannelAnalytics. Подключение —
// в настройках проекта. Доступен всем залогиненным (гость → middleware на /login).
export default function ChannelPage() {
  return <ChannelAnalytics />;
}
