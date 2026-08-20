-- Интеграция с Instagram (пер-проектная, как YouTube).
CREATE TABLE "InstagramIntegration" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profilePicture" TEXT,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "accessToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstagramIntegration_conversationId_key" ON "InstagramIntegration"("conversationId");

ALTER TABLE "InstagramIntegration" ADD CONSTRAINT "InstagramIntegration_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
