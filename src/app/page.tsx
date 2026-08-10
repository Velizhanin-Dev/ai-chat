import LandingNav from "@/components/Landing/LandingNav";
import Hero from "@/components/Landing/Hero";
import Features from "@/components/Landing/Features";
import Workspace from "@/components/Landing/Workspace";
import Showcase from "@/components/Landing/Showcase";
import Pricing from "@/components/Landing/Pricing";
import FinalCta from "@/components/Landing/FinalCta";
import { getSettings } from "@/lib/settings";
import { getActivePlans } from "@/lib/plans";

// Лендинг читает фичефлаги и тарифы серверно. Pre-launch (launch.countdownEnabled
// + дата): в герое — таймер обратного отсчёта, тарифы скрыты до запуска.
export const dynamic = "force-dynamic";

export default async function Home() {
  const [{ launch }, plans] = await Promise.all([getSettings(), getActivePlans()]);
  const launchMode = launch.countdownEnabled && Boolean(launch.targetAt);

  return (
    <>
      <LandingNav hidePricing={launchMode} launchMode={launchMode} />
      <main>
        <Hero launchTarget={launchMode ? launch.targetAt : null} />
        <Features />
        {/* Разделы вокруг чата: аналитика, контент-план, превью, дорожная карта. */}
        <Workspace />
        <Showcase />
        {!launchMode && <Pricing plans={plans} />}
        <FinalCta hidePricing={launchMode} launchMode={launchMode} />
      </main>
    </>
  );
}
