-- CreateTable
CREATE TABLE "ChannelRoadmap" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "signals" JSONB,
    "signalsAt" TIMESTAMP(3),
    "steps" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelRoadmap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRoadmap_conversationId_key" ON "ChannelRoadmap"("conversationId");

-- AddForeignKey
ALTER TABLE "ChannelRoadmap" ADD CONSTRAINT "ChannelRoadmap_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
