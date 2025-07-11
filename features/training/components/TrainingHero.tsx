import Image from "next/image";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n";

export const TrainingHero = () => {
  return (
    <section className="relative flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0">
        <Image
          src="/images/hero.jpg"
          alt="Deskohub training room"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-black/60" />
      </div>

      <div className="relative z-10 text-center max-w-4xl mx-auto px-4">
        <h1 className="text-5xl md:text-7xl font-bold mb-6">
          <span className="text-green-400">{m["training.hero.title"]()}</span>
          <br />
          <span className="text-white">{m["training.hero.subtitle"]()}</span>
        </h1>

        <p className="text-xl md:text-2xl text-white/90 mb-8 max-w-2xl mx-auto">
          {m["training.hero.description"]()}
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button
            size="lg"
            className="bg-green-500 hover:bg-green-600 text-white px-8 py-4 text-lg"
          >
            {m["training.hero.reserveButton"]()}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="border-white text-white hover:bg-white hover:text-black px-8 py-4 text-lg bg-transparent"
          >
            {m["training.hero.galleryButton"]()}
          </Button>
        </div>
      </div>
    </section>
  );
};
