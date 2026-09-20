import { m } from "@/features/i18n";
import { Hero } from "@/shared/components";

export function EntranceFeesHero() {
  return (
    <Hero tags="Menu">
      <div>
        <h1 className="text-5xl md:text-6xl font-bold text-green-400 mb-4">
          {m["entranceFees.heroTitle"]()}
        </h1>
        <p className="text-xl text-white max-w-2xl mx-auto text-center">
          {m["entranceFees.heroSubtitle"]()}
        </p>
      </div>
    </Hero>
  );
}
