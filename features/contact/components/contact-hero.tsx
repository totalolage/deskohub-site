import { m } from "@/i18n";
import { Hero } from "@/shared/components/hero";

export function ContactHero() {
  return (
    <Hero imageSrc="/images/hero.jpg" className="text-center">
      <h1 className="text-5xl md:text-6xl font-bold text-green-400 mb-4">
        {m["contact.heroTitle"]()}
      </h1>
      <p className="text-xl text-white max-w-2xl mx-auto">
        {m["contact.heroSubtitle"]()}
      </p>
    </Hero>
  );
}
