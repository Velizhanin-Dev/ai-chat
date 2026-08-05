import ContentPlanBoard from "@/components/ContentPlan/ContentPlanBoard";

// Раздел «Контент-план»: месячная сетка роликов по методике (канбан по статусам).
// Пер-проектный, доступен всем залогиненным (гость → middleware на /login).
export default function ContentPlanPage() {
  return <ContentPlanBoard />;
}
