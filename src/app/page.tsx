import LandingNav from "@/components/Landing/LandingNav";
import Hero from "@/components/Landing/Hero";
import Features from "@/components/Landing/Features";
import Showcase from "@/components/Landing/Showcase";
import Pricing from "@/components/Landing/Pricing";
import FinalCta from "@/components/Landing/FinalCta";

export default function Home() {
  return (
    <>
      <LandingNav />
      <main>
        <Hero />
        <Features />
        <Showcase />
        <Pricing />
        <FinalCta />
      </main>
    </>
  );
}
