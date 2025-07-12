import heroImage from "@/assets/images/hero.jpg";
import { m } from "@/i18n";
import { Hero } from "@/shared/components";

export function MenuHero() {
  return (
    <Hero imageSrc={heroImage}>
      <div className="relative z-10 text-center">
        <h1 className="text-5xl md:text-7xl font-bold text-green-400 mb-4">
          {m["menu.hero.title"]()}
        </h1>
        <p className="text-xl text-white max-w-2xl mx-auto px-4">
          {m["menu.hero.subtitle"]()}
        </p>
      </div>
    </Hero>
  );
}
