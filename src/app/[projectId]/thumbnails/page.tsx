import ThumbnailStudio from "@/components/Thumbnails/ThumbnailStudio";

// Раздел «Генератор превью» (заменил заглушку «Разборы»). Доступ — только
// админам: страница лежит в route-group (locked) с серверным гвардом, а API
// дополнительно проверяет THUMBNAILS_ADMIN_ONLY (src/lib/thumbnails-server.ts).
export default function ThumbnailsPage({
  params,
}: {
  params: { projectId: string };
}) {
  return <ThumbnailStudio projectId={params.projectId} />;
}
