import Image, { ImageProps } from "next/image";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { setLocale } from "@/src/paraglide/runtime";
import heroImage from "@/assets/images/hero.jpg";
import logoImage from "@/assets/images/logo.png";
import placeholderImage from "@/assets/images/placeholder/placeholder.svg";
import { PropsWithParams } from "./route";
import { m } from "@/src/paraglide/messages";

export default async function Component({ params }: PropsWithParams) {
  const { lang } = await params;
  setLocale(lang, { reload: false }); // Set locale for server-side rendering

  return (
    <div className="min-h-screen bg-white [--header-height:80px]">
      {/* Header */}
      <header className="bg-black text-white px-6 sticky top-0 z-20 h-[var(--header-height)] flex   items-center justify-center">
        <div className="flex items-center justify-between max-w-7xl w-full">
          <Image src={logoImage} alt="Deskohub" width={100} height={80} />
          <nav className="hidden md:flex space-x-8">
            <a href="#home" className="hover:text-green-400 transition-colors">
              {m["nav.home"]()}
            </a>
            <a href="#" className="hover:text-green-400 transition-colors">
              {m["nav.boardGames"]()}
            </a>
            <a href="#" className="hover:text-green-400 transition-colors">
              {m["nav.gallery"]()}
            </a>
            <a href="#" className="hover:text-green-400 transition-colors">
              {m["nav.menu"]()}
            </a>
            <a href="#" className="hover:text-green-400 transition-colors">
              {m["nav.trainingRoom"]()}
            </a>
            <a href="#" className="hover:text-green-400 transition-colors">
              {m["nav.contact"]()}
            </a>
          </nav>
          <div className="flex items-center space-x-4">
            <LanguageSwitcher />
            <Button className="bg-green-500 hover:bg-green-600 text-white">
              {m["buttons.reservation"]()}
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative h-[calc(100dvh_-_var(--header-height))] bg-gradient-to-r from-black/70 to-black/50 z-1">
        <Image
          className="mix-blend-overlay brightness-[0.7]"
          src={heroImage}
          fill
          objectFit="cover"
          alt="Hero image"
        />
        <div className="relative z-10 flex items-center justify-center h-full text-center text-white px-6">
          <div className="max-w-4xl">
            <h1 className="text-6xl md:text-8xl font-bold mb-8 leading-tight">
              <span className="text-green-500">{m["hero.title"]()}</span>
              <br />
              {m["hero.subtitle"]()}
            </h1>
            <div className="flex flex-col md:flex-row items-center justify-center space-y-4 md:space-y-0 md:space-x-8 mt-12">
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                <div className="text-sm text-green-400">
                  {m["hours.weekdays"]()}
                </div>
                <div className="text-lg font-semibold">
                  {m["hours.weekdaysTime"]()}
                </div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                <div className="text-sm text-green-400">
                  {m["hours.weekends"]()}
                </div>
                <div className="text-lg font-semibold">
                  {m["hours.weekendsTime"]()}
                </div>
              </div>
            </div>
            <p className="mt-8 text-lg max-w-2xl mx-auto text-gray-200">
              {m["hero.description"]()}
            </p>
          </div>
        </div>
      </section>

      {/* Gallery Section */}
      <section className="py-16 bg-amber-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            <div className="rounded-full overflow-hidden aspect-square">
              <Image
                src={placeholderImage}
                alt="Board games"
                width={300}
                height={300}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="rounded-full overflow-hidden aspect-square">
              <Image
                src={placeholderImage}
                alt="Gaming area"
                width={300}
                height={300}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="rounded-full overflow-hidden aspect-square">
              <Image
                src={placeholderImage}
                alt="Café atmosphere"
                width={300}
                height={300}
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          <div className="text-center max-w-4xl mx-auto">
            <p className="text-lg text-gray-700 leading-relaxed">
              {m["about.description"]()}
            </p>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-4xl md:text-6xl font-bold text-gray-900 mb-2">
                500+
              </div>
              <div className="text-gray-600 font-medium">
                {m["stats.boardGames"]()}
              </div>
            </div>
            <div>
              <div className="text-4xl md:text-6xl font-bold text-gray-900 mb-2">
                200+
              </div>
              <div className="text-gray-600 font-medium">
                {m["stats.happyPlayers"]()}
              </div>
            </div>
            <div>
              <div className="text-4xl md:text-6xl font-bold text-gray-900 mb-2">
                5+
              </div>
              <div className="text-gray-600 font-medium">
                {m["stats.yearsExperience"]()}
              </div>
            </div>
            <div>
              <div className="text-4xl md:text-6xl font-bold text-gray-900 mb-2">
                100+
              </div>
              <div className="text-gray-600 font-medium">
                {m["stats.gameNights"]()}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Games Gallery */}
      <section className="py-16 bg-amber-50">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            {m["gamesSection.title"]()}
          </h2>
          <h3 className="text-4xl md:text-5xl font-bold text-gray-900 mb-16">
            {m["gamesSection.subtitle"]()}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            {(
              [
                {
                  nameKey: "gameCategories.strategic",
                  image: placeholderImage,
                },
                {
                  nameKey: "gameCategories.party",
                  image: placeholderImage,
                },
                {
                  nameKey: "gameCategories.cooperative",
                  image: placeholderImage,
                },
                {
                  nameKey: "gameCategories.family",
                  image: placeholderImage,
                },
                {
                  nameKey: "gameCategories.logic",
                  image: placeholderImage,
                },
                {
                  nameKey: "gameCategories.card",
                  image: placeholderImage,
                },
                {
                  nameKey: "gameCategories.economic",
                  image: placeholderImage,
                },
                {
                  nameKey: "gameCategories.adventure",
                  image: placeholderImage,
                },
                {
                  nameKey: "gameCategories.abstract",
                  image: placeholderImage,
                },
              ] satisfies {
                nameKey: keyof typeof m;
                image: ImageProps['src'];
              }[]
            ).map((game, index) => (
              <div key={index} className="text-center">
                <div className="rounded-full overflow-hidden aspect-square mb-4 mx-auto w-48 h-48">
                  <Image
                    src={game.image}
                    alt={m[game.nameKey]()}
                    width={200}
                    height={200}
                    className="w-full h-full object-cover"
                  />
                </div>
                <h4 className="font-bold text-gray-900">{m[game.nameKey]()}</h4>
              </div>
            ))}
          </div>

          <Button className="bg-green-500 hover:bg-green-600 text-white px-8 py-3 rounded-full">
            {m["buttons.showMore"]()}
          </Button>
        </div>
      </section>

      {/* Location Section */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-8 leading-tight">
                {m["locationSection.title"]()}
                <br />
                {m["locationSection.subtitle"]()}
              </h2>
              <Button className="bg-transparent border-2 border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white px-8 py-3 rounded-full">
                {m["buttons.ourLocation"]()}
              </Button>
            </div>
            <div className="rounded-lg overflow-hidden">
              <Image
                src={placeholderImage}
                alt="Café location"
                width={600}
                height={400}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="py-16 bg-amber-900 text-white text-center">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-4xl md:text-5xl font-bold mb-8">
            {m["contactSection.title"]()}
            <br />
            {m["contactSection.subtitle"]()}
          </h2>
          <Button className="bg-green-500 hover:bg-green-600 text-white px-8 py-3 rounded-full">
            {m["buttons.contact"]()}
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white py-8 border-t">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <Image
                src={logoImage}
                alt="Deskohub"
                width={24}
                height={24}
                className="w-6 h-6"
              />
              <div>
                <div className="font-bold">Deskohub</div>
                <div className="text-sm text-gray-600">
                  {m["footer.tagline"]()}
                </div>
              </div>
            </div>
            <div className="flex space-x-6 text-sm text-gray-600">
              <a href="#" className="hover:text-green-500">
                {m["footer.socialLinks.instagram"]()}
              </a>
              <a href="#" className="hover:text-green-500">
                {m["footer.socialLinks.facebook"]()}
              </a>
              <a href="#" className="hover:text-green-500">
                {m["footer.socialLinks.tiktok"]()}
              </a>
              <a href="#" className="hover:text-green-500">
                {m["footer.socialLinks.linkedin"]()}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
