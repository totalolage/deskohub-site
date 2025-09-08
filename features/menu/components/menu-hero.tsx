import { m } from "@/features/i18n";
import { Hero } from "@/shared/components";

export function MenuHero() {
  return (
    <Hero tags="Menu" alignment="left">
      <div>
        <h1 className="text-5xl md:text-7xl font-bold text-green-400 mb-4">
          {m["menu.hero.title"]()}
        </h1>
        <p className="text-xl text-white max-w-2xl">
          {m["menu.hero.subtitle"]()}
        </p>
      </div>
    </Hero>
  );
}
