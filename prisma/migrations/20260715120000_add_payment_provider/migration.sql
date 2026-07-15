-- AlterTable: провайдер оплаты (tbank | cloudpayments) для маршрутизации синка статуса.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'tbank';
