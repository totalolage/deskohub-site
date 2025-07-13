import Image from "next/image";
import { m } from "@/i18n";
import { Card } from "@/shared/components/ui/card";

export function GallerySpaces() {
  const establishingShots = [
    {
      src: "/placeholder.svg?height=400&width=600",
      alt: m["gallery.spaces.locations.mainRoom"](),
      title: m["gallery.spaces.locations.mainRoom"](),
    },
    {
      src: "/placeholder.svg?height=400&width=600",
      alt: m["gallery.spaces.locations.cozyCorner"](),
      title: m["gallery.spaces.locations.cozyCorner"](),
    },
    {
      src: "/placeholder.svg?height=400&width=600",
      alt: m["gallery.spaces.locations.bar"](),
      title: m["gallery.spaces.locations.bar"](),
    },
    {
      src: "/placeholder.svg?height=400&width=600",
      alt: m["gallery.spaces.locations.gamesCollection"](),
      title: m["gallery.spaces.locations.gamesCollection"](),
    },
    {
      src: "/placeholder.svg?height=400&width=600",
      alt: m["gallery.spaces.locations.eveningAtmosphere"](),
      title: m["gallery.spaces.locations.eveningAtmosphere"](),
    },
    {
      src: "/placeholder.svg?height=400&width=600",
      alt: m["gallery.spaces.locations.trainingRoom"](),
      title: m["gallery.spaces.locations.trainingRoom"](),
    },
  ];

  return (
    <section className="py-16 px-4 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl font-bold text-center mb-4">
          {m["gallery.spaces.title"]()}
        </h2>
        <p className="text-gray-600 text-center mb-12 max-w-2xl mx-auto">
          {m["gallery.spaces.subtitle"]()}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {establishingShots.map((shot) => (
            <Card
              key={JSON.stringify(shot)}
              className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group"
            >
              <div className="relative aspect-[3/2] overflow-hidden">
                <Image
                  src={shot.src || "/placeholder.svg"}
                  alt={shot.alt}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-lg">{shot.title}</h3>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
