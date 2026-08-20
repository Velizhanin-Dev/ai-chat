-- Кэш расшифровок роликов (субтитры через yt-dlp). Данные публичные, ключ — videoId.
CREATE TABLE "VideoTranscript" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT NOT NULL,
    "segments" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoTranscript_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoTranscript_videoId_key" ON "VideoTranscript"("videoId");
