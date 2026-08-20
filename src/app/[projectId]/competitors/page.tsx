import CompetitorsList from "@/components/Competitors/CompetitorsList";

// Раздел «Конкуренты» — свой список каналов и их свежие ролики. Открыт всем
// залогиненным (гейт — middleware + владение проектом в API). Дешёвый: ~2 units
// на канал, в отличие от соседнего поиска референсов.
export default function CompetitorsPage() {
  return <CompetitorsList />;
}
