import { LocalizedLink as Link, m } from "@/features/i18n";
import { Hero } from "@/shared/components";
import { Price } from "@/shared/components/price";
import { Button } from "@/shared/components/ui/button";
import { siteConstants } from "@/shared/utils/constants";

export const TrainingHero = () => {
  return (
    <Hero tags="Školící místnost" alignment="left">
      <div>
        <h1 className="text-5xl md:text-7xl font-bold mb-6">
          <span className="text-green-400">{m["training.hero.title"]()}</span>
          <br />
          <span className="text-white">{m["training.hero.subtitle"]()}</span>
        </h1>

        <p className="text-xl md:text-2xl text-white/90 mb-8 max-w-2xl">
          {m["training.hero.description"]()}
        </p>

        <div className="flex flex-wrap gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
            <p className="text-white/70 text-sm mb-1">
              {m["training.capacity.people"]({
                capacity: siteConstants.pricing.trainingRoom.capacity,
              })}
            </p>
            <p className="text-2xl font-bold text-white">
              <Price amount={siteConstants.pricing.training.hourly} />
              <span className="text-base font-normal">
                {m["training.capacity.hourly"]({ price: "" }).trim()}
              </span>
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
            <p className="text-white/70 text-sm mb-1">
              {m["training.capacity.size"]({
                size: siteConstants.pricing.trainingRoom.size,
              })}
            </p>
            <p className="text-2xl font-bold text-white">
              <Price amount={siteConstants.pricing.training.daily} />
              <span className="text-base font-normal">
                {m["training.capacity.daily"]({ price: "" }).trim()}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          {siteConstants.featureFlags.boardroomReservations ? (
            <Link href="/training-room/reservation">
              <Button
                size="lg"
                className="bg-green-500 hover:bg-green-600 text-white px-8 py-4 text-lg"
              >
                {m["training.hero.reserveButton"]()}
              </Button>
            </Link>
          ) : (
            <Link href="/contact">
              <Button
                size="lg"
                className="bg-green-500 hover:bg-green-600 text-white px-8 py-4 text-lg"
              >
                {m["buttons.contact"]()}
              </Button>
            </Link>
          )}
          {siteConstants.featureFlags.gallery && (
            <Link href="/training-room/gallery">
              <Button
                size="lg"
                variant="outline"
                className="border-white text-white hover:bg-white hover:text-black px-8 py-4 text-lg bg-transparent"
              >
                {m["training.hero.galleryButton"]()}
              </Button>
            </Link>
          )}
        </div>
      </div>
    </Hero>
  );
};
