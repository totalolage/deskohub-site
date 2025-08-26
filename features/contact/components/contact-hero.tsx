import { m } from "@/i18n";
import { Hero } from "@/shared/components";

export function ContactHero() {
  return (
    <Hero tags="Kontakt" alignment="left">
      <div>
        <h1 className="text-5xl md:text-6xl font-bold text-green-400 mb-4">
          {m["contact.heroTitle"]()}
        </h1>
        <p className="text-xl text-white max-w-2xl">
          {m["contact.heroSubtitle"]()}
        </p>
      </div>
    </Hero>
  );
}
