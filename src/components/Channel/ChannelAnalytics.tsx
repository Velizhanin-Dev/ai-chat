"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Skeleton, Stack } from "@mantine/core";
import { useProjectPlatform } from "@/hooks/useProjectPlatform";
import { apiChannelLinkStatus, apiYouTubeStatus } from "@/lib/youtube-client";
import ChannelDashboard from "./ChannelDashboard";
import InstagramDashboard from "./InstagramDashboard";
import PublicChannelDashboard from "./PublicChannelDashboard";

// Развилка раздела «Аналитика».
//
// ⚠️ Дашборды РАЗНЫЕ, а не один с ветвлениями внутри: у YouTube под OAuth матрица
// «упаковка ↔ содержание», удержание по кривой и разбор по 7 параметрам; у
// Instagram — пропуски, среднее время и вовлечение, потому что кривой удержания и
// источников трафика Graph API не отдаёт вовсе. Пытаться свести их в один экран —
// значит половину показателей рисовать пустыми.
//
// ⚠️ Третья ветка — канал, привязанный ПО ССЫЛКЕ (бренд-аккаунт, к которому у
// человека нет доступа через Google). Там публичных данных ещё меньше, и экран
// снова свой: ролики с просмотрами и сравнением с медианой канала плюс вопросы
// зрителей — то, что реально доступно без Analytics API.
export default function ChannelAnalytics() {
  const { platform } = useProjectPlatform();
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";
  // null — ещё не знаем; ждём ответа, чтобы не мигнуть чужим экраном.
  const [linkedOnly, setLinkedOnly] = useState<boolean | null>(null);

  useEffect(() => {
    if (platform === "instagram" || !projectId) {
      setLinkedOnly(false);
      return;
    }
    let alive = true;
    // ⚠️ Сначала спрашиваем про OAuth: полный доступ строго лучше публичного, и
    // при обоих сразу показывать надо именно его.
    apiYouTubeStatus(projectId).then(async (res) => {
      if (!alive) return;
      if (res.ok && res.data.connected) {
        setLinkedOnly(false);
        return;
      }
      const link = await apiChannelLinkStatus(projectId);
      if (!alive) return;
      setLinkedOnly(link.ok && link.data.linked);
    });
    return () => {
      alive = false;
    };
  }, [platform, projectId]);

  if (platform === "instagram") return <InstagramDashboard />;
  if (linkedOnly === null) {
    return (
      <Stack gap="md">
        <Skeleton h={110} radius="lg" />
        <Skeleton h={260} radius="lg" />
      </Stack>
    );
  }
  return linkedOnly ? <PublicChannelDashboard /> : <ChannelDashboard />;
}
