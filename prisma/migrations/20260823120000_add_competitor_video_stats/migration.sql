-- Дневные снимки просмотров роликов конкурентов: у YouTube истории по чужому
-- ролику нет, а без неё не отличить «×5 за год» от «×5 за неделю».
CREATE TABLE "CompetitorVideoStat" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorVideoStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompetitorVideoStat_videoId_day_key" ON "CompetitorVideoStat"("videoId", "day");
CREATE INDEX "CompetitorVideoStat_videoId_day_idx" ON "CompetitorVideoStat"("videoId", "day");
