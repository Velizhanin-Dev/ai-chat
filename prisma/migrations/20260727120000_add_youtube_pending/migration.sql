-- CreateTable (черновое подключение YouTube на время брифа: проекта ещё нет,
-- токены временно висят на юзере и переезжают в YouTubeIntegration при создании проекта)
CREATE TABLE "YouTubePendingConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "thumbnail" TEXT,
    "customUrl" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubePendingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YouTubePendingConnection_userId_key" ON "YouTubePendingConnection"("userId");

-- AddForeignKey
ALTER TABLE "YouTubePendingConnection" ADD CONSTRAINT "YouTubePendingConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
