import { Calendar, Users } from "lucide-react";
import Image from "next/image";
import { m } from "@/i18n";
import { Badge } from "@/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

export function GalleryEvents() {
  const eventAlbums = [
    {
      title: m["gallery.events.tournaments.catan.title"](),
      date: "15. prosince 2024",
      participants: 24,
      photos: 18,
      coverImage: "/placeholder.svg?height=300&width=400",
      description: m["gallery.events.tournaments.catan.description"](),
    },
    {
      title: m["gallery.events.tournaments.christmas.title"](),
      date: "22. prosince 2024",
      participants: 35,
      photos: 25,
      coverImage: "/placeholder.svg?height=300&width=400",
      description: m["gallery.events.tournaments.christmas.description"](),
    },
    {
      title: m["gallery.events.tournaments.gameNight.title"](),
      date: "8. prosince 2024",
      participants: 18,
      photos: 22,
      coverImage: "/placeholder.svg?height=300&width=400",
      description: m["gallery.events.tournaments.gameNight.description"](),
    },
    {
      title: m["gallery.events.tournaments.familyDay.title"](),
      date: "1. prosince 2024",
      participants: 42,
      photos: 31,
      coverImage: "/placeholder.svg?height=300&width=400",
      description: m["gallery.events.tournaments.familyDay.description"](),
    },
    {
      title: m["gallery.events.tournaments.magic.title"](),
      date: "25. listopadu 2024",
      participants: 16,
      photos: 14,
      coverImage: "/placeholder.svg?height=300&width=400",
      description: m["gallery.events.tournaments.magic.description"](),
    },
    {
      title: m["gallery.events.tournaments.dnd.title"](),
      date: "18. listopadu 2024",
      participants: 12,
      photos: 20,
      coverImage: "/placeholder.svg?height=300&width=400",
      description: m["gallery.events.tournaments.dnd.description"](),
    },
  ];

  return (
    <section className="py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl font-bold text-center mb-4">
          {m["gallery.events.title"]()}
        </h2>
        <p className="text-gray-600 text-center mb-12 max-w-2xl mx-auto">
          {m["gallery.events.subtitle"]()}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {eventAlbums.map((album, index) => (
            <Card
              key={index}
              className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group"
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <Image
                  src={album.coverImage || "/placeholder.svg"}
                  alt={album.title}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute top-4 right-4">
                  <Badge variant="secondary" className="bg-black/70 text-white">
                    {album.photos} {m["gallery.events.photos"]()}
                  </Badge>
                </div>
              </div>
              <CardHeader>
                <CardTitle className="text-xl">{album.title}</CardTitle>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {album.date}
                  </div>
                  <div className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {album.participants} {m["gallery.events.participants"]()}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">{album.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
