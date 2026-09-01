import { LocalizedLink as Link, m } from "@/features/i18n";

export function GamesGallery() {
  return (
    <section className="py-16 bg-amber-50">
      <div className="max-w-7xl mx-auto px-6 text-center">
        <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
          {m["gamesSection.title"]()}
        </h2>
        <h3 className="text-4xl md:text-5xl font-bold text-gray-900 mb-16">
          {m["gamesSection.subtitle"]()}
        </h3>

        <Link
          className="rounded-full bg-green-500 px-8 py-3 text-white hover:bg-green-600"
          href="/board-games"
        >
          {m["buttons.seeList"]()}
        </Link>
      </div>
    </section>
  );
}
