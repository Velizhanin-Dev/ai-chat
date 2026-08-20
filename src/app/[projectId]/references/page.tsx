import CompetitorsBoard from "@/components/Competitors/CompetitorsBoard";

// Раздел «Поиск референсов» — поиск роликов по нише. Открыт всем залогиненным.
// ⚠️ Поисковый запрос стоит 100 units квоты YouTube (обычный вызов — 1), поэтому
// он идёт по отдельному пулу ключей и кэшируется на 6 часов (см. competitors-server).
export default function ReferencesPage() {
  return <CompetitorsBoard />;
}
