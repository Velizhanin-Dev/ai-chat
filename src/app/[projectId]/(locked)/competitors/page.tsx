import CompetitorsBoard from "@/components/Competitors/CompetitorsBoard";

// Раздел «Конкуренты в нише» — пока только админам: лежит в route-group (locked),
// её серверный layout отдаёт не-админу 404. Открывать всем рано — поиск по YouTube
// стоит 100 units квоты за запрос.
export default function CompetitorsPage() {
  return <CompetitorsBoard />;
}
