import Link from "next/link";
import trainingRoomImage from "@/assets/images/photos/teambuilding_room_2.jpeg";
import { m } from "@/i18n";
import { Hero } from "@/shared/components/hero";
import { Button } from "@/shared/components/ui/button";

export const TrainingHero = () => {
  return (
    <Hero imageSrc={trainingRoomImage.src} alignment="left">
      <div>
        <h1 className="text-5xl md:text-7xl font-bold mb-6">
          <span className="text-green-400">{m["training.hero.title"]()}</span>
          <br />
          <span className="text-white">{m["training.hero.subtitle"]()}</span>
        </h1>

        <p className="text-xl md:text-2xl text-white/90 mb-8 max-w-2xl">
          {m["training.hero.description"]()}
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <Link href="/training-room/reservation">
            <Button
              size="lg"
              className="bg-green-500 hover:bg-green-600 text-white px-8 py-4 text-lg"
            >
              {m["training.hero.reserveButton"]()}
            </Button>
          </Link>
          <Button
            size="lg"
            variant="outline"
            className="border-white text-white hover:bg-white hover:text-black px-8 py-4 text-lg bg-transparent"
          >
            {m["training.hero.galleryButton"]()}
          </Button>
        </div>
      </div>
    </Hero>
  );
};
