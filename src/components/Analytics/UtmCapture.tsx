"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { captureUtm } from "@/lib/utm-client";

// Захват UTM-меток из адреса в localStorage (первое касание + последнее). Дальше
// они уезжают в User при регистрации и в Payment при оплате — см. src/lib/utm.ts.
// Отдельно от YandexMetrika намеренно: метки нужны нашей собственной атрибуции
// (кто в итоге купил), даже когда счётчик Метрики не подключён.
export default function UtmCapture() {
  const pathname = usePathname();

  useEffect(() => {
    captureUtm();
  }, [pathname]);

  return null;
}
