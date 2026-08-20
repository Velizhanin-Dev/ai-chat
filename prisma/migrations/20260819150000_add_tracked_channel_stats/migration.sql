-- Дневные снимки цифр отслеживаемых каналов (у YouTube истории нет — копим сами).
CREATE TABLE "TrackedChannelStat" (
    "id" TEXT NOT NULL,
    "channelRowId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "subscribers" INTEGER NOT NULL,
    "views" BIGINT NOT NULL,
    "videoCount" INTEGER NOT NULL,

    CONSTRAINT "TrackedChannelStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrackedChannelStat_channelRowId_day_key" ON "TrackedChannelStat"("channelRowId", "day");

ALTER TABLE "TrackedChannelStat" ADD CONSTRAINT "TrackedChannelStat_channelRowId_fkey" FOREIGN KEY ("channelRowId") REFERENCES "TrackedChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
