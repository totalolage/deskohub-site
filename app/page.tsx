import Image from "next/image"
import { Button } from "@/components/ui/button"

export default function Component() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-black text-white px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-r from-pink-500 via-green-500 to-blue-500 rounded"></div>
            <span className="text-xl font-bold">Deskohub</span>
          </div>
          <nav className="hidden md:flex space-x-8">
            <a href="#" className="hover:text-green-400 transition-colors">
              DOMŮ
            </a>
            <a href="#" className="hover:text-green-400 transition-colors">
              DESKOVÉ HRY
            </a>
            <a href="#" className="hover:text-green-400 transition-colors">
              GALERIE
            </a>
            <a href="#" className="hover:text-green-400 transition-colors">
              MENU
            </a>
            <a href="#" className="hover:text-green-400 transition-colors">
              ŠKOLÍCÍ MÍSTNOST
            </a>
            <a href="#" className="hover:text-green-400 transition-colors">
              KONTAKT
            </a>
          </nav>
          <Button className="bg-green-500 hover:bg-green-600 text-white">Rezervace</Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative h-screen bg-gradient-to-r from-black/70 to-black/50">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: "url('/placeholder.svg?height=800&width=1200')",
            backgroundBlendMode: "overlay",
          }}
        ></div>
        <div className="relative z-10 flex items-center justify-center h-full text-center text-white px-6">
          <div className="max-w-4xl">
            <h1 className="text-6xl md:text-8xl font-bold mb-8 leading-tight">
              ŽIVOT ZAČÍNÁ
              <br />
              PO <span className="text-green-400">HRANÍ</span>
            </h1>
            <div className="flex flex-col md:flex-row items-center justify-center space-y-4 md:space-y-0 md:space-x-8 mt-12">
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                <div className="text-sm text-green-400">PO - ČT</div>
                <div className="text-lg font-semibold">15:00-23:00</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                <div className="text-sm text-green-400">PÁ - SO</div>
                <div className="text-lg font-semibold">15:00-24:00</div>
              </div>
            </div>
            <p className="mt-8 text-lg max-w-2xl mx-auto text-gray-200">
              Vstupné pro hráče deskových her. Cena je 50 Kč pro deskohráče, kteří si u nás něco objednají a 100 Kč pro
              zákazníky s nulovou útratu.
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
                src="/placeholder.svg?height=300&width=300"
                alt="Board games"
                width={300}
                height={300}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="rounded-full overflow-hidden aspect-square">
              <Image
                src="/placeholder.svg?height=300&width=300"
                alt="Gaming area"
                width={300}
                height={300}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="rounded-full overflow-hidden aspect-square">
              <Image
                src="/placeholder.svg?height=300&width=300"
                alt="Café atmosphere"
                width={300}
                height={300}
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          <div className="text-center max-w-4xl mx-auto">
            <p className="text-lg text-gray-700 leading-relaxed">
              Vstupné pro hráče deskových her. Cena je 50 Kč pro deskohráče, kteří si u nás něco objednají a 100 Kč pro
              zákazníky s nulovou útratu. Vstupné platí 1 den bez hodinového omezení. Pro děti vstup do 15 let zdarma.
              PONDĚLÍ BEZ VSTUPNÉHO.
            </p>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-4xl md:text-6xl font-bold text-gray-900 mb-2">500+</div>
              <div className="text-gray-600 font-medium">Deskových Her</div>
            </div>
            <div>
              <div className="text-4xl md:text-6xl font-bold text-gray-900 mb-2">200+</div>
              <div className="text-gray-600 font-medium">Spokojených Hráčů</div>
            </div>
            <div>
              <div className="text-4xl md:text-6xl font-bold text-gray-900 mb-2">5+</div>
              <div className="text-gray-600 font-medium">Let Zkušeností</div>
            </div>
            <div>
              <div className="text-4xl md:text-6xl font-bold text-gray-900 mb-2">100+</div>
              <div className="text-gray-600 font-medium">Herních Večerů</div>
            </div>
          </div>
        </div>
      </section>

      {/* Games Gallery */}
      <section className="py-16 bg-amber-50">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">OBJEVTE NAŠE</h2>
          <h3 className="text-4xl md:text-5xl font-bold text-gray-900 mb-16">ÚŽASNÉ DESKOVÉ HRY</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            {[
              { name: "STRATEGICKÉ", image: "/placeholder.svg?height=200&width=200" },
              { name: "PÁRTY HRY", image: "/placeholder.svg?height=200&width=200" },
              { name: "KOOPERATIVNÍ", image: "/placeholder.svg?height=200&width=200" },
              { name: "RODINNÉ", image: "/placeholder.svg?height=200&width=200" },
              { name: "LOGICKÉ", image: "/placeholder.svg?height=200&width=200" },
              { name: "KARETNÍ", image: "/placeholder.svg?height=200&width=200" },
              { name: "EKONOMICKÉ", image: "/placeholder.svg?height=200&width=200" },
              { name: "DOBRODRUŽNÉ", image: "/placeholder.svg?height=200&width=200" },
              { name: "ABSTRAKTNÍ", image: "/placeholder.svg?height=200&width=200" },
            ].map((game, index) => (
              <div key={index} className="text-center">
                <div className="rounded-full overflow-hidden aspect-square mb-4 mx-auto w-48 h-48">
                  <Image
                    src={game.image || "/placeholder.svg"}
                    alt={game.name}
                    width={200}
                    height={200}
                    className="w-full h-full object-cover"
                  />
                </div>
                <h4 className="font-bold text-gray-900">{game.name}</h4>
              </div>
            ))}
          </div>

          <Button className="bg-green-500 hover:bg-green-600 text-white px-8 py-3 rounded-full">ZOBRAZIT VÍCE</Button>
        </div>
      </section>

      {/* Location Section */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-8 leading-tight">
                V OKOLÍ?
                <br />
                NAJDĚTE NÁS
              </h2>
              <Button className="bg-transparent border-2 border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white px-8 py-3 rounded-full">
                NAŠE LOKACE
              </Button>
            </div>
            <div className="rounded-lg overflow-hidden">
              <Image
                src="/placeholder.svg?height=400&width=600"
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
            MÁTE OTÁZKY NEBO POTŘEBUJETE
            <br />
            INFORMACE?
          </h2>
          <Button className="bg-green-500 hover:bg-green-600 text-white px-8 py-3 rounded-full">KONTAKT</Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white py-8 border-t">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <div className="w-6 h-6 bg-gradient-to-r from-pink-500 via-green-500 to-blue-500 rounded"></div>
              <div>
                <div className="font-bold">Deskohub</div>
                <div className="text-sm text-gray-600">Café • Deskové hry • Komunita</div>
              </div>
            </div>
            <div className="flex space-x-6 text-sm text-gray-600">
              <a href="#" className="hover:text-green-500">
                Instagram
              </a>
              <a href="#" className="hover:text-green-500">
                Facebook
              </a>
              <a href="#" className="hover:text-green-500">
                TikTok
              </a>
              <a href="#" className="hover:text-green-500">
                LinkedIn
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
