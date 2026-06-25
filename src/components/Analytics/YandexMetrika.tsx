"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { YM_ID, ymHit } from "@/lib/metrika";

// Счётчик Яндекс.Метрики + учёт SPA-навигаций. Рендерится в layout. Если
// NEXT_PUBLIC_YM_ID не задан — ничего не подключаем (хуки безвредны, no-op).
export default function YandexMetrika() {
  const pathname = usePathname();
  // Первый просмотр считает сам init; на последующих клиентских переходах
  // (App Router без полной перезагрузки) шлём hit вручную, пропуская маунт.
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ymHit(window.location.pathname + window.location.search);
  }, [pathname]);

  if (!YM_ID) return null;

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive">
        {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${YM_ID},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});`}
      </Script>
      <noscript>
        <div>
          <img
            src={`https://mc.yandex.ru/watch/${YM_ID}`}
            style={{ position: "absolute", left: "-9999px" }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}
