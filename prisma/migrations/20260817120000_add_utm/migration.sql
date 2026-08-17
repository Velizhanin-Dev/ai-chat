-- UTM-атрибуция. У пользователя — ПЕРВОЕ касание (по какой ссылке пришёл впервые;
-- referrer/landing заполняются и без меток, чтобы видеть органику и прямые заходы).
-- У платежа — метка на момент оформления (last-touch): человек мог прийти из телеграма,
-- а купить после рассылки. См. src/lib/utm.ts.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "utmSource" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "utmMedium" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "utmContent" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "utmTerm" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "utmReferrer" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "utmLanding" TEXT;

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "utmSource" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "utmMedium" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "utmContent" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "utmTerm" TEXT;
