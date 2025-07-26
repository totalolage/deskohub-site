import type { BoardGame } from "../types/board-games.types";

export const boardGamesData: BoardGame[] = [
  {
    name: {
      "en-US": "7 Wonders Duel",
      "cs-CZ": "7 Divů světa duel",
    },
    expansions: "Pantheon",
    language: "EN",
    duration: 30,
    rating: 8.1,
    bggLink: "https://boardgamegeek.com/boardgame/173346/7-wonders-duel",
    description: {
      "en-US":
        "Card-based civilization strategy for two players where each builds their city, scientific discoveries, and military strength.",
      "cs-CZ":
        "Karetní civilizační strategie pro dva hráče, kde každý buduje své město, vědecké objevy a vojenskou sílu.",
    },
    players: "2",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: {
      "en-US": "Age of Galaxy",
      "cs-CZ": "Galaktické aliance",
    },
    language: "EN",
    duration: [60, 90],
    rating: 7.5,
    bggLink: "https://boardgamegeek.com/boardgame/355915/age-galaxy",
    description: {
      "en-US":
        "Small but deep sci-fi strategic game offering a full 4X experience.",
      "cs-CZ":
        "Malá, ale hluboká sci-fi strategická hra nabízející plnohodnotný 4X zážitek.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "AI: 100% Human",
    language: "Jazykově nezávislé",
    duration: [15, 30],
    rating: 6.8,
    bggLink: "https://boardgamegeek.com/boardgame/345987/ai-100-human",
    description: {
      "en-US":
        "Drafting card game where players build their own tableau using cards.",
      "cs-CZ":
        "Draftovací karetní hra, ve které hráči budují svou vlastní tabuli (tableau) pomocí karet.",
    },
    players: "2-4",
    difficulty: "easy",
    category: "Party",
  },
  {
    name: "Akropolis",
    language: "Jazykově nezávislé",
    duration: [20, 30],
    rating: 7.4,
    bggLink: "https://boardgamegeek.com/boardgame/349779/akropolis",
    description: {
      "en-US":
        "Abstract puzzle where players build their own ancient city using hex tiles.",
      "cs-CZ":
        "Abstraktní skládačka, ve které hráči staví své vlastní antické město pomocí hexových destiček.",
    },
    players: "2-4",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: {
      "en-US": "Alchemists",
      "cs-CZ": "Alchymisté",
    },
    expansions: "Králův golem (The King's Golem)",
    language: "EN",
    duration: [90, 120],
    rating: 7.8,
    bggLink: "https://boardgamegeek.com/boardgame/161970/alchemists",
    description: {
      "en-US":
        "Deductive strategy game where players become alchemists trying to discover the secrets of various ingredients.",
      "cs-CZ":
        "Deduktivní strategická hra, ve které se hráči stávají alchymisty snažícími se odhalit tajemství různých ingrediencí.",
    },
    players: "2-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Anachrony",
    expansions: "Fractures of Time, Future Imperfect",
    language: "EN",
    duration: [90, 150],
    rating: 8.4,
    bggLink: "https://boardgamegeek.com/boardgame/185343/anachrony",
    description: {
      "en-US":
        "Complex euro strategy with worker-placement elements and time travel.",
      "cs-CZ":
        "Komplexní euro strategie s prvky worker-placementu a cestování časem.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: {
      "en-US": "Apiary",
      "cs-CZ": "Včelín",
    },
    expansions: "Expanding the Hive",
    language: "EN",
    duration: [60, 90],
    rating: 7.2,
    bggLink: "https://boardgamegeek.com/boardgame/362379/apiary",
    description: {
      "en-US":
        "Strategic worker-placement game set in a futuristic world of bees.",
      "cs-CZ":
        "Strategická hra s worker-placementem zasazená do futuristického světa včel.",
    },
    players: "1-5",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: {
      "en-US": "Ark Nova",
      "cs-CZ": "Archa Nova",
    },
    expansions: "Marine Worlds",
    language: "EN",
    duration: [90, 150],
    rating: 8.7,
    bggLink: "https://boardgamegeek.com/boardgame/342942/ark-nova",
    description: {
      "en-US":
        "Strategic game where players build and manage their own modern zoo.",
      "cs-CZ":
        "Strategická hra, ve které hráči budují a spravují vlastní moderní zoologickou zahradu.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: {
      "en-US": "Arkham Horror (Third Edition)",
      "cs-CZ": "Arkham Horror (Třetí edice)",
    },
    expansions: "Dead of Night, Secrets of the Order, Under Dark Waves",
    language: "EN",
    duration: [120, 180],
    rating: 7.5,
    bggLink:
      "https://boardgamegeek.com/boardgame/251247/arkham-horror-third-edition",
    description: {
      "en-US": "Cooperative horror game set in the world of H. P. Lovecraft.",
      "cs-CZ": "Kooperativní hororová hra zasazená do světa H. P. Lovecrafta.",
    },
    players: "1-6",
    difficulty: "hard",
    category: "Dungeon Crawler",
  },
  {
    name: {
      "en-US": "Ashes Reborn: Rise of the Phoenixborn",
      "cs-CZ": "Ashes Reborn: Znovuzrození Phoenixbornů",
    },
    expansions:
      "The Children of Blackcloud, The Law of Lions, The Protector of Argaia, The Song of Soaksend",
    language: "EN",
    duration: [30, 60],
    rating: 7.8,
    bggLink:
      "https://boardgamegeek.com/boardgame/279215/ashes-reborn-rise-phoenixborn",
    description: {
      "en-US":
        "Tactical card game where players fight as powerful Phoenixborn using magic and summoning allies.",
      "cs-CZ":
        "Taktická karetní hra, kde hráči bojují jako mocní Phoenixborni pomocí magie a přivolávání spojenců.",
    },
    players: "2",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Azul",
    language: "Jazykově nezávislé",
    duration: [30, 45],
    rating: 7.9,
    bggLink: "https://boardgamegeek.com/boardgame/230802/azul",
    description: {
      "en-US":
        "Abstract strategy game where players decorate the palace of the Portuguese king with beautiful tiles.",
      "cs-CZ":
        "Abstraktní strategická hra, ve které hráči zdobí palác portugalského krále pomocí nádherných dlaždic.",
    },
    players: "2-4",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: {
      "en-US": "Barrage",
      "cs-CZ": "Přehrada",
    },
    expansions:
      "Executive Officer Promo A, Executive Officer Promo B, The Leeghwater Project",
    language: "EN",
    duration: 120,
    rating: 8.2,
    bggLink: "https://boardgamegeek.com/boardgame/251247/barrage",
    description: {
      "en-US":
        "Economic strategy game about building dams, power plants, and managing water resources.",
      "cs-CZ":
        "Ekonomická strategická hra o stavbě přehrad, elektráren a správě vodních zdrojů.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: {
      "en-US": "Beast",
      "cs-CZ": "Bestie",
    },
    language: "CZ",
    duration: [60, 120],
    rating: 7.4,
    bggLink: "https://boardgamegeek.com/boardgame/345989/beast",
    description: {
      "en-US":
        "Asymmetric game where one player becomes the Beast and others try to track it down and defeat it.",
      "cs-CZ":
        "Asymetrická hra, kde se jeden hráč stává Bestií a ostatní se ji snaží vypátrat a porazit.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Dungeon Crawler",
  },
  {
    name: {
      "en-US": "Beyond the Horizon",
      "cs-CZ": "Cestou Pokroku",
    },
    language: "EN",
    duration: [30, 60],
    rating: 7.3,
    bggLink: "https://boardgamegeek.com/boardgame/355920/beyond-horizon",
    description: {
      "en-US":
        "Adventure game with exploration of unknown territories, fleet building, and discovering new islands.",
      "cs-CZ":
        "Dobrodružná hra s průzkumem neznámých území, budováním flotily a objevováním nových ostrovů.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Cristal Palace",
    language: "Jazykově nezávislé",
    duration: 0,
    rating: 0,
    players: "2-5",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Beyond the Sun",
    expansions: "Leaders of the New Dawn",
    language: "EN",
    duration: [60, 120],
    rating: 8.1,
    bggLink: "https://boardgamegeek.com/boardgame/317985/beyond-sun",
    description: {
      "en-US":
        "Sci-fi strategic game about technological development and space colonization.",
      "cs-CZ":
        "Sci-fi strategická hra o technologickém rozvoji a kolonizaci vesmíru.",
    },
    players: "2-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Bios: Megafauna (Second Edition)",
    language: "EN",
    duration: [120, 180],
    rating: 7.7,
    bggLink:
      "https://boardgamegeek.com/boardgame/226525/bios-megafauna-second-edition",
    description: {
      "en-US":
        "Evolution game where players guide the development of vertebrates and adapt to changing ecosystems.",
      "cs-CZ":
        "Evoluční hra, kde hráči řídí vývoj obratlovců a přizpůsobují se měnícímu ekosystému.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Bios: Mesofauna",
    language: "EN",
    duration: [90, 150],
    rating: 7.5,
    bggLink: "https://boardgamegeek.com/boardgame/285774/bios-mesofauna",
    description: {
      "en-US":
        "Game about the evolution of smaller animals, their adaptation and genetic mutations.",
      "cs-CZ":
        "Hra o evoluci menších živočichů, jejich adaptaci a genetických mutacích.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Bitoku",
    language: "EN",
    duration: [90, 120],
    rating: 7.8,
    bggLink: "https://boardgamegeek.com/boardgame/305925/bitoku",
    description: {
      "en-US":
        "Euro game inspired by Japanese mythology where players compete for the role of forest guardian.",
      "cs-CZ":
        "Euro hra inspirovaná japonskou mytologií, kde hráči soutěží o roli ochránce lesa.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Bonfire",
    language: "EN",
    duration: [70, 120],
    rating: 7.6,
    bggLink: "https://boardgamegeek.com/boardgame/300322/bonfire",
    description: {
      "en-US": "Strategic game by Stefan Feld about rekindling ancient fires.",
      "cs-CZ":
        "Strategická hra Stefana Felda o znovu zažehnutí prastarých ohňů.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Brass: Birmingham",
    expansions: "Iron Clays",
    language: "Jazykově nezávislé",
    duration: [120, 180],
    rating: 8.6,
    bggLink: "https://boardgamegeek.com/boardgame/224517/brass-birmingham",
    description: {
      "en-US":
        "Economic game set in the Industrial Revolution where players build trade networks and compete in industrial development.",
      "cs-CZ":
        "Ekonomická hra zasazená do průmyslové revoluce, kde hráči budují obchodní sítě a konkurují v rozvoji průmyslu.",
    },
    players: "2-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: {
      "en-US": "Calico",
      "cs-CZ": "Pelíšek",
    },
    language: "Jazykově nezávislé",
    duration: [30, 45],
    rating: 7.8,
    bggLink: "https://boardgamegeek.com/boardgame/312484/calico",
    description: {
      "en-US":
        "Abstract logic game where players create quilts and attract cats.",
      "cs-CZ":
        "Abstraktní logická hra, kde hráči vytvářejí přikrývky a přitahují kočky.",
    },
    players: "1-4",
    difficulty: "medium",
    category: "Family",
  },
  {
    name: {
      "en-US": "Carnival of Monsters",
      "cs-CZ": "Obludárium",
    },
    language: "CZ",
    duration: [45, 60],
    rating: 7.5,
    bggLink: "https://boardgamegeek.com/boardgame/272533/carnival-monsters",
    description: {
      "en-US":
        "Card drafting game about monster hunters, collecting fantastic creatures, and strategy.",
      "cs-CZ":
        "Karetní draftovací hra o lovcích příšer, sběru fantastických stvoření a strategii.",
    },
    players: "2-5",
    difficulty: "medium",
    category: "Party",
  },
  {
    name: "The Castles of Burgundy",
    language: "Jazykově nezávislé",
    duration: [30, 90],
    rating: 8.1,
    bggLink: "https://boardgamegeek.com/boardgame/84876/castles-burgundy",
    description: {
      "en-US":
        "Strategic euro game about building estates using dice and tiles.",
      "cs-CZ":
        "Strategická euro hra o budování panství pomocí kostek a destiček.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "CATAN",
    language: "CZ",
    duration: [60, 90],
    rating: 7.2,
    bggLink: "https://boardgamegeek.com/boardgame/13/catan",
    description: {
      "en-US":
        "Classic game about building settlements, trading, and resource management.",
      "cs-CZ": "Klasická hra o budování osad, obchodování a správě surovin.",
    },
    players: "3-4",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Caverna: The Cave Farmers",
    expansions: "The Forgotten Folk",
    language: "EN",
    duration: [60, 120],
    rating: 8.0,
    bggLink: "https://boardgamegeek.com/boardgame/102794/caverna-cave-farmers",
    description: {
      "en-US":
        "Worker-placement game about resource management, cave expansion, and animal breeding.",
      "cs-CZ":
        "Worker-placement hra o správě zdrojů, rozšiřování jeskyně a chovu zvířat.",
    },
    players: "1-7",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Churchill",
    language: "EN",
    duration: [60, 180],
    rating: 7.4,
    bggLink: "https://boardgamegeek.com/boardgame/177639/churchill",
    description: {
      "en-US":
        "Historical strategic game about diplomacy between Churchill, Roosevelt, and Stalin's alliance.",
      "cs-CZ":
        "Historická strategická hra o diplomacii mezi Churchillovou, Rooseveltovou a Stalinovou aliancí.",
    },
    players: "3",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: {
      "en-US": "City of the Great Machine",
      "cs-CZ": "V zajetí všehostroje",
    },
    expansions: "Stand-In Heroes, The Escalation",
    language: "EN",
    duration: [60, 120],
    rating: 7.6,
    bggLink: "https://boardgamegeek.com/boardgame/318882/city-great-machine",
    description: {
      "en-US":
        "Asymmetric game about revolution against the Great Machine or controlling it.",
      "cs-CZ":
        "Asymetrická hra o revoluci proti Velkému stroji nebo jeho ovládání.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Clank! In! Space!: A Deck-Building Adventure",
    language: "EN",
    duration: [45, 90],
    rating: 7.9,
    bggLink:
      "https://boardgamegeek.com/boardgame/205327/clank-space-deck-building-adventure",
    description: {
      "en-US":
        "Deck-building game with sci-fi elements where players infiltrate a spaceship and steal artifacts.",
      "cs-CZ":
        "Deck-building hra s prvky sci-fi, kde hráči infiltrují vesmírnou loď a kradou artefakty.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Dungeon Crawler",
  },
  {
    name: "Clank! Legacy: Acquisitions Incorporated",
    language: "EN",
    duration: [90, 120],
    rating: 8.2,
    bggLink:
      "https://boardgamegeek.com/boardgame/269144/clank-legacy-acquisitions-incorporated",
    description: {
      "en-US":
        "Legacy version of Clank! where players uncover story and change the game world.",
      "cs-CZ":
        "Legacy verze Clank!, kde hráči odkrývají příběh a mění herní svět.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Dungeon Crawler",
  },
  {
    name: {
      "en-US": "Clank!: Catacombs",
      "cs-CZ": "Clank!: Katakomby",
    },
    language: "CZ",
    duration: [45, 90],
    rating: 7.8,
    bggLink: "https://boardgamegeek.com/boardgame/368208/clank-catacombs",
    description: {
      "en-US": "Clank! variant with modular catacomb map and new challenges.",
      "cs-CZ": "Varianta Clank! s modulární mapou katakomb a novými výzvami.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Dungeon Crawler",
  },
  {
    name: {
      "en-US": "Codenames",
      "cs-CZ": "Krycí jména",
    },
    language: "EN",
    duration: [15, 30],
    rating: 7.7,
    bggLink: "https://boardgamegeek.com/boardgame/178900/codenames",
    description: {
      "en-US": "Party game about word associations and team captains' clues.",
      "cs-CZ": "Párty hra o slovních asociacích a nápovědách kapitánů týmů.",
    },
    players: "2-8+",
    difficulty: "easy",
    category: "Party",
  },
  {
    name: {
      "en-US": "Codenames: Pictures",
      "cs-CZ": "Krycí jména: Obrázky",
    },
    language: "Jazykově nezávislé",
    duration: [15, 30],
    rating: 7.5,
    bggLink: "https://boardgamegeek.com/boardgame/198773/codenames-pictures",
    description: {
      "en-US": "Codenames variant with illustrations instead of words.",
      "cs-CZ": "Varianta Krycích jmen s ilustracemi místo slov.",
    },
    players: "2-8+",
    difficulty: "easy",
    category: "Party",
  },
  {
    name: "Codex Naturalis",
    language: "EN",
    duration: [20, 40],
    rating: 7.3,
    bggLink: "https://boardgamegeek.com/boardgame/318484/codex-naturalis",
    description: {
      "en-US":
        "Card game about assembling an ancient codex and scoring points.",
      "cs-CZ": "Karetní hra o sestavování starověkého kodexu a získávání bodů.",
    },
    players: "2-4",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Cooper Island",
    language: "EN",
    duration: [60, 120],
    rating: 7.8,
    bggLink: "https://boardgamegeek.com/boardgame/283850/cooper-island",
    description: {
      "en-US":
        "Heavy strategic game about island colonization and resource management.",
      "cs-CZ": "Těžká strategická hra o kolonizaci ostrova a správě zdrojů.",
    },
    players: "2-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Daitoshi",
    language: "EN",
    duration: [60, 120],
    rating: 7.4,
    bggLink: "https://boardgamegeek.com/boardgame/368509/daitoshi",
    description: {
      "en-US": "Strategic game about influence in a futuristic city.",
      "cs-CZ": "Strategická hra o vlivu ve futuristickém městě.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: {
      "en-US": "Darwin's Journey: Collector's Edition",
      "cs-CZ": "Darwinova cesta",
    },
    language: "EN",
    duration: [60, 120],
    rating: 8.0,
    bggLink: "https://boardgamegeek.com/boardgame/318184/darwins-journey",
    description: {
      "en-US":
        "Worker-placement game inspired by Charles Darwin's journey to the Galapagos.",
      "cs-CZ":
        "Worker-placement hra inspirovaná cestou Charlese Darwina po Galapágách.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: {
      "en-US": "Discworld: Ankh-Morpork",
      "cs-CZ": "Zeměplocha: Ankh-Morpork",
    },
    language: "EN",
    duration: 60,
    rating: 7.4,
    bggLink: "https://boardgamegeek.com/boardgame/90241/discworld-ankh-morpork",
    description: {
      "en-US":
        "Game based on Terry Pratchett's world where players with secret goals compete for power over Ankh-Morpork.",
      "cs-CZ":
        "Hra podle světa Terryho Pratchetta, kde hráči s tajnými cíli soupeří o moc nad městem Ankh-Morpork.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: {
      "en-US": "Dead of Winter",
      "cs-CZ": "Dead of Winter (Zima Mrtvých)",
    },
    language: "EN",
    duration: [60, 120],
    rating: 7.5,
    bggLink:
      "https://boardgamegeek.com/boardgame/150376/dead-of-winter-a-crossroads-game",
    description: {
      "en-US":
        "Players take on the role of survivors trying to survive in a hostile world full of dangerous mutants and frozen areas.",
      "cs-CZ":
        "Hráč se ujímá role přeživšího, který se snaží přežít v nehostinném světě plném nebezpečných mutantů a zmrzlých oblastí.",
    },
    players: "2-5",
    difficulty: "medium",
    category: "Dungeon Crawler",
  },
  {
    name: "Desítka",
    language: "CZ",
    duration: 0,
    rating: 0,
    players: "2-4",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Discordia",
    language: "Jazykově nezávislé",
    duration: 0,
    rating: 7.5,
    bggLink: "https://boardgamegeek.com/boardgame/360206/discordia",
    players: "1-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Dixit",
    language: "Jazykově nezávislé",
    duration: 30,
    rating: 7.8,
    bggLink: "https://boardgamegeek.com/boardgame/39856/dixit",
    description: {
      "en-US":
        "Creative card game full of beautiful illustrations where players create clues for their cards.",
      "cs-CZ":
        "Kreativní karetní hra plná nádherných ilustrací, kde hráči vymýšlejí nápovědy ke svým kartám.",
    },
    players: "3-6",
    difficulty: "easy",
    category: "Party",
  },
  {
    name: "Dominant Species: Marine",
    language: "CZ",
    duration: [120, 180],
    rating: 8.2,
    bggLink:
      "https://boardgamegeek.com/boardgame/284393/dominant-species-marine",
    description: {
      "en-US":
        "Strategic game about marine species survival in a changing ecosystem.",
      "cs-CZ":
        "Strategická hra o přežití mořských druhů v měnícím se ekosystému.",
    },
    players: "2-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: {
      "en-US": "Dune: Imperium",
      "cs-CZ": "Duna: Impérium",
    },
    expansions: "Immortality, Rise of Ix",
    language: "EN",
    duration: [60, 120],
    rating: 8.4,
    bggLink: "https://boardgamegeek.com/boardgame/316554/dune-imperium",
    description: {
      "en-US":
        "Deck-building and worker-placement game inspired by the world of Dune where players lead factions in the struggle for power.",
      "cs-CZ":
        "Deck-building a worker-placement hra inspirovaná světem Duny, kde hráči vedou frakce v boji o moc.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Dune: Imperium – Uprising",
    language: "EN",
    duration: [60, 120],
    rating: 8.1,
    bggLink:
      "https://boardgamegeek.com/boardgame/365717/dune-imperium-uprising",
    description: {
      "en-US":
        "Standalone version of Dune: Imperium with new mechanics and strategic possibilities.",
      "cs-CZ":
        "Samostatná verze Dune: Imperium s novými mechanikami a strategickými možnostmi.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Ecologic",
    language: "EN",
    duration: 0,
    rating: 0,
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Eldritch Horror",
    expansions:
      "Cities in Ruin, Forsaken Lore, Masks of Nyarlathotep, Mountains of Madness, Signs of Carcosa, Strange Remnants, The Dreamlands, Under the Pyramids",
    language: "EN",
    duration: [120, 240],
    rating: 8.0,
    bggLink: "https://boardgamegeek.com/boardgame/146021/eldritch-horror",
    description: {
      "en-US":
        "Cooperative game inspired by H. P. Lovecraft's myths where players face ancient threats.",
      "cs-CZ":
        "Kooperativní hra inspirovaná mýty H. P. Lovecrafta, kde hráči čelí prastarým hrozbám.",
    },
    players: "1-8",
    difficulty: "hard",
    category: "Dungeon Crawler",
  },
  {
    name: "Evacuation",
    language: "EN",
    duration: [90, 150],
    rating: 7.6,
    bggLink: "https://boardgamegeek.com/boardgame/355915/evacuation",
    description: {
      "en-US":
        "Strategic game about evacuating a dying planet and colonizing a new world.",
      "cs-CZ":
        "Strategická hra o evakuaci umírající planety a kolonizaci nového světa.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Everdell",
    expansions: "Bellfaire, Mistwood, Spirecrest",
    language: "EN",
    duration: [40, 120],
    rating: 8.3,
    bggLink: "https://boardgamegeek.com/boardgame/199792/everdell",
    description: {
      "en-US":
        "Beautifully illustrated worker-placement game about building a city of forest creatures.",
      "cs-CZ":
        "Krásně ilustrovaná worker-placement hra o budování města lesních tvorů.",
    },
    players: "1-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Flatiron",
    language: "EN",
    duration: 0,
    rating: 0,
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Divukraj",
    language: "CZ",
    duration: 0,
    rating: 0,
    players: "2-4",
    difficulty: "medium",
    category: "Family",
  },
  {
    name: {
      "en-US": "Terraforming Mars",
      "cs-CZ": "Mars Terraformace",
    },
    expansions: "Všechna rozšíření mimo Politiky",
    language: "CZ",
    duration: 120,
    rating: 8.4,
    bggLink: "https://boardgamegeek.com/boardgame/167791/terraforming-mars",
    description: {
      "en-US":
        "Players represent corporations tasked with terraforming Mars and making it habitable.",
      "cs-CZ":
        "Hráči zastupují korporace, které mají za úkol teraformovat Mars a učinit ho obyvatelným.",
    },
    players: "1-5",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Molly house",
    language: "EN",
    duration: 0,
    rating: 0,
    players: "2-4",
    difficulty: "medium",
    category: "Party",
  },
  {
    name: "Fantasy Realms: Deluxe Edition",
    language: "EN",
    duration: [20, 40],
    rating: 7.9,
    bggLink:
      "https://boardgamegeek.com/boardgame/343156/fantasy-realms-deluxe-edition",
    description: {
      "en-US":
        "Deluxe edition of the card game where players create the strongest combination of cards.",
      "cs-CZ":
        "Deluxe edice karetní hry, ve které hráči vytvářejí nejsilnější kombinaci karet.",
    },
    players: "3-6",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "The First Tsar: Ivan the Terrible",
    language: "EN",
    duration: [60, 90],
    rating: 7.5,
    bggLink:
      "https://boardgamegeek.com/boardgame/368278/first-tsar-ivan-terrible",
    description: {
      "en-US":
        "Historical strategic game inspired by Russia during the reign of Ivan the Terrible.",
      "cs-CZ":
        "Historická strategická hra inspirovaná Ruskem za vlády Ivana Hrozného.",
    },
    players: "1-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "The Fox in the Forest Duet",
    language: "EN",
    duration: 30,
    rating: 7.4,
    bggLink: "https://boardgamegeek.com/boardgame/300220/fox-forest-duet",
    description: {
      "en-US":
        "Cooperative card game for two players that develops the concept of The Fox in the Forest.",
      "cs-CZ":
        "Kooperativní karetní hra pro dva hráče, která rozvíjí koncept hry The Fox in the Forest.",
    },
    players: "2",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Gùgōng",
    expansions: "Pànjūn",
    language: "Jazykově nezávislé",
    duration: 90,
    rating: 7.4,
    bggLink: "https://boardgamegeek.com/boardgame/250458/gugong",
    players: "1-5",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Hanabi",
    language: "Jazykově nezávislé",
    duration: 25,
    rating: 7.8,
    bggLink: "https://boardgamegeek.com/boardgame/98778/hanabi",
    description: {
      "en-US":
        "Card game about communication and coordination while lighting fireworks.",
      "cs-CZ": "Karetní hra o komunikaci a koordinaci při hašení ohňostrojů.",
    },
    players: "2-5",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Hanamikoji",
    language: "Jazykově nezávislé",
    duration: [15, 30],
    rating: 7.6,
    bggLink: "https://boardgamegeek.com/boardgame/145371/hanamikoji",
    description: {
      "en-US": "Strategic card game for two players set in historical Japan.",
      "cs-CZ":
        "Strategická karetní hra pro dva hráče odehrávající se v historickém Japonsku.",
    },
    players: "2",
    difficulty: "easy",
    category: "Strategic",
  },
  {
    name: "High Frontier 4 All",
    language: "EN",
    duration: [180, 240],
    rating: 8.0,
    bggLink: "https://boardgamegeek.com/boardgame/286352/high-frontier-4-all",
    description: {
      "en-US":
        "Complex strategic game simulating exploration and colonization of the solar system.",
      "cs-CZ":
        "Komplexní strategická hra simulující průzkum a kolonizaci sluneční soustavy.",
    },
    players: "1-5",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Imperium: Classics",
    language: "EN",
    duration: [60, 120],
    rating: 8.1,
    bggLink: "https://boardgamegeek.com/boardgame/319050/imperium-classics",
    description: {
      "en-US": "Civilization building game with deck-building elements.",
      "cs-CZ": "Civilizační budovatelská hra s prvky deck-buildingu.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Imperium: Horizons",
    language: "EN",
    duration: [60, 120],
    rating: 8.3,
    bggLink: "https://boardgamegeek.com/boardgame/319051/imperium-horizons",
    description: {
      "en-US":
        "Continuation of the Imperium series with new factions and strategies.",
      "cs-CZ": "Pokračování série Imperium s novými frakcemi a strategiemi.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Imperium: Legends",
    language: "EN",
    duration: [60, 120],
    rating: 8.2,
    bggLink: "https://boardgamegeek.com/boardgame/319052/imperium-legends",
    description: {
      "en-US":
        "Imperium variant with a different selection of civilizations to play.",
      "cs-CZ": "Varianta Imperium s jiným výběrem civilizací k hraní.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Inis",
    language: "EN",
    duration: [60, 90],
    rating: 8.0,
    bggLink: "https://boardgamegeek.com/boardgame/176494/inis",
    description: {
      "en-US":
        "Strategic game about expansion and mythological battles in the Celtic world.",
      "cs-CZ":
        "Strategická hra o expanzi a mytologických soubojích v keltském světě.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Inventions: Evolution of Ideas",
    language: "Jazykově nezávislé",
    duration: [60, 120],
    rating: 7.7,
    bggLink:
      "https://boardgamegeek.com/boardgame/342942/inventions-evolution-ideas",
    description: {
      "en-US":
        "Strategic game about inventions and innovations throughout human history.",
      "cs-CZ":
        "Strategická hra o vynálezech a inovacích v průběhu lidské historie.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "It's a Wonderful World",
    expansions: "Corruption & Ascension",
    language: "Jazykově nezávislé",
    duration: [30, 60],
    rating: 7.8,
    bggLink: "https://boardgamegeek.com/boardgame/274364/its-wonderful-world",
    description: {
      "en-US": "Building game with cards where players develop their empire.",
      "cs-CZ":
        "Budovatelská hra s kartami, ve které hráči rozvíjejí své impérium.",
    },
    players: "1-5",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "John Company: Second Edition",
    language: "EN",
    duration: [120, 180],
    rating: 8.1,
    bggLink:
      "https://boardgamegeek.com/boardgame/314530/john-company-second-edition",
    description: {
      "en-US":
        "Game simulating the management of the British East India Company.",
      "cs-CZ": "Hra simulující správu Britské východoindické společnosti.",
    },
    players: "1-6",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "The King Is Dead: Second Edition",
    language: "Jazykově nezávislé",
    duration: [30, 60],
    rating: 7.8,
    bggLink:
      "https://boardgamegeek.com/boardgame/173090/king-dead-second-edition",
    description: {
      "en-US":
        "Strategic game about taking control of Britain after the king's death.",
      "cs-CZ":
        "Strategická hra o převzetí kontroly nad Británií po smrti krále.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Kaskádie",
    language: "Jazykově nezávislé",
    duration: 0,
    rating: 0,
    players: "1-4",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Kutná Hora",
    language: "CZ",
    duration: 0,
    rating: 0,
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Lisboa",
    language: "Jazykově nezávislé",
    duration: [90, 120],
    rating: 8.2,
    bggLink: "https://boardgamegeek.com/boardgame/197376/lisboa",
    description: {
      "en-US":
        "Economic euro game about rebuilding Lisbon after the earthquake.",
      "cs-CZ": "Ekonomická euro hra o přestavbě Lisabonu po zemětřesení.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Lords of Waterdeep",
    expansions: "Scoundrels of Skullport",
    language: "EN",
    duration: [60, 120],
    rating: 7.8,
    bggLink: "https://boardgamegeek.com/boardgame/110327/lords-waterdeep",
    description: {
      "en-US": "Worker-placement game set in the fantasy world of Waterdeep.",
      "cs-CZ": "Worker-placement hra zasazená do fantasy světa Waterdeepu.",
    },
    players: "2-5",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Lost Ruins of Arnak",
    expansions: "Expedition Leaders, The Missing Expedition",
    language: "EN",
    duration: [60, 120],
    rating: 8.4,
    bggLink: "https://boardgamegeek.com/boardgame/312484/lost-ruins-arnak",
    description: {
      "en-US":
        "Adventure deck-building and worker-placement game set in lost ruins.",
      "cs-CZ":
        "Dobrodružná deck-building a worker-placement hra zasazená do ztracených ruin.",
    },
    players: "1-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Messina 1347",
    language: "Jazykově nezávislé",
    duration: [60, 150],
    rating: 7.7,
    bggLink: "https://boardgamegeek.com/boardgame/333514/messina-1347",
    description: {
      "en-US": "Game about city management during the plague epidemic of 1347.",
      "cs-CZ": "Hra o správě města během morové epidemie v roce 1347.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "MLEM: Space Agency",
    language: "Jazykově nezávislé",
    duration: [30, 60],
    rating: 7.2,
    bggLink: "https://boardgamegeek.com/boardgame/371144/mlem-space-agency",
    description: {
      "en-US": "Family game about building a space program for cats.",
      "cs-CZ": "Rodinná hra o budování vesmírného programu pro kočky.",
    },
    players: "2-5",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Mottainai",
    language: "EN",
    duration: [20, 40],
    rating: 7.1,
    bggLink: "https://boardgamegeek.com/boardgame/182875/mottainai",
    description: {
      "en-US": "Fast card game inspired by Glory to Rome.",
      "cs-CZ": "Rychlá karetní hra inspirovaná hrou Glory to Rome.",
    },
    players: "2-5",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Munchkin",
    language: "EN",
    duration: 60,
    rating: 7.4,
    bggLink: "https://boardgamegeek.com/boardgame/1927/munchkin",
    description: {
      "en-US": "Satirical fantasy game full of humor and backstabbing.",
      "cs-CZ": "Satirická fantasy hra plná humoru a podrazů.",
    },
    players: "3-6",
    difficulty: "easy",
    category: "Party",
  },
  {
    name: "Munchkin Zombies",
    language: "EN",
    duration: 60,
    rating: 7.2,
    bggLink: "https://boardgamegeek.com/boardgame/73298/munchkin-zombies",
    description: {
      "en-US": "Munchkin variant set in a zombie apocalypse world.",
      "cs-CZ": "Varianta Munchkina zasazená do světa zombie apokalypsy.",
    },
    players: "3-6",
    difficulty: "easy",
    category: "Party",
  },
  {
    name: "Neanderthal",
    language: "CZ",
    duration: [60, 120],
    rating: 7.3,
    bggLink: "https://boardgamegeek.com/boardgame/173007/neanderthal",
    description: {
      "en-US":
        "Evolution game about the survival of prehistoric hunters and gatherers.",
      "cs-CZ": "Evoluční hra o přežití pravěkých lovců a sběračů.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Nemesis",
    expansions: "Aftermath & Void Seeders",
    language: "EN",
    duration: [90, 180],
    rating: 8.5,
    bggLink: "https://boardgamegeek.com/boardgame/167355/nemesis",
    description: {
      "en-US": "Sci-fi horror game about survival on an abandoned spaceship.",
      "cs-CZ": "Sci-fi hororová hra o přežití na opuštěné vesmírné lodi.",
    },
    players: "1-5",
    difficulty: "hard",
    category: "Dungeon Crawler",
  },
  {
    name: "Noctiluca",
    language: "Jazykově nezávislé",
    duration: [30, 45],
    rating: 7.5,
    bggLink: "https://boardgamegeek.com/boardgame/269695/noctiluca",
    description: {
      "en-US": "Family abstract game about collecting glowing jellyfish.",
      "cs-CZ": "Rodinná abstraktní hra o sbírání světélkujících medúz.",
    },
    players: "1-4",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Nucleum",
    language: "Jazykově nezávislé",
    duration: [90, 150],
    rating: 8.0,
    bggLink: "https://boardgamegeek.com/boardgame/373223/nucleum",
    description: {
      "en-US":
        "Complex strategic game about managing energy resources and railways.",
      "cs-CZ":
        "Komplexní strategická hra o správě energetických zdrojů a železnic.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Northgard",
    expansions: "Náčelníci, Divočiny",
    language: "CZ",
    duration: 0,
    rating: 0,
    players: "2-6",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: {
      "en-US": "Citadels",
      "cs-CZ": "Citadel",
    },
    language: "EN",
    duration: [45, 60],
    rating: 7.4,
    bggLink: "https://boardgamegeek.com/boardgame/478/citadels",
    description: {
      "en-US": "Classic game about building cities and bluffing.",
      "cs-CZ": "Klasická hra o budování měst a blafování.",
    },
    players: "2-8",
    difficulty: "easy",
    category: "Party",
  },
  {
    name: "On Mars",
    language: "Jazykově nezávislé",
    duration: [120, 150],
    rating: 8.4,
    bggLink: "https://boardgamegeek.com/boardgame/182028/mars",
    description: {
      "en-US": "Complex strategic game about colonizing Mars.",
      "cs-CZ": "Komplexní strategická hra o kolonizaci Marsu.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Outlive",
    language: "EN",
    duration: [60, 90],
    rating: 7.8,
    bggLink: "https://boardgamegeek.com/boardgame/207979/outlive",
    description: {
      "en-US": "Post-apocalyptic game about survival and resource management.",
      "cs-CZ": "Postapokalyptická hra o přežití a správě zdrojů.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: {
      "en-US": "TRAILS",
      "cs-CZ": "Parky na cestách",
    },
    language: "CZ",
    duration: [20, 40],
    rating: 7.1,
    bggLink: "https://boardgamegeek.com/boardgame/338628/trails",
    description: {
      "en-US":
        "Board game where players represent tourists hiking through American nature.",
      "cs-CZ":
        "Desková hra, ve které hráči představují turisty putující americkou přírodou.",
    },
    players: "2-4",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Pax Pamir: Second Edition",
    language: "EN",
    duration: [45, 90],
    rating: 8.3,
    bggLink:
      "https://boardgamegeek.com/boardgame/256960/pax-pamir-second-edition",
    description: {
      "en-US":
        "Game about politics, alliances, and diplomacy in the 19th century.",
      "cs-CZ": "Hra o politice, aliancích a diplomacii v 19. století.",
    },
    players: "1-5",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Pax Emancipation",
    language: "EN",
    duration: 0,
    rating: 0,
    players: "1-3",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Petrichor",
    expansions: "Flowers, Honeybee",
    language: "Jazykově nezávislé",
    duration: [20, 40],
    rating: 7.2,
    bggLink: "https://boardgamegeek.com/boardgame/217372/petrichor",
    description: {
      "en-US": "Game simulating weather and plant ecosystems.",
      "cs-CZ": "Hra simulující počasí a ekosystémy rostlin.",
    },
    players: "1-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Point Salad",
    language: "Jazykově nezávislé",
    duration: [15, 30],
    rating: 7.6,
    bggLink: "https://boardgamegeek.com/boardgame/274960/point-salad",
    description: {
      "en-US": "Fast card game about creating salads.",
      "cs-CZ": "Rychlá karetní hra o vytváření salátů.",
    },
    players: "2-6",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: {
      "en-US": "Thurn and Taxis",
      "cs-CZ": "Poštovní kurýr",
    },
    language: "CZ",
    duration: 45,
    rating: 6.9,
    bggLink: "https://boardgamegeek.com/boardgame/21790/thurn-and-taxis",
    description: {
      "en-US":
        "Simple euro game for families. Your goal is to build a successful postal network.",
      "cs-CZ":
        "Jednoduchá euro hra pro rodiny. Vaším cílem je postavit úspěšnou poštovní síť",
    },
    players: "2-4",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Port Royal",
    language: "CZ",
    duration: [20, 50],
    rating: 7.1,
    bggLink: "https://boardgamegeek.com/boardgame/156009/port-royal",
    description: {
      "en-US":
        "Port Royal is a card game where players trade, hire pirates and merchants to gain the most wealth.",
      "cs-CZ":
        "Port Royal je karetní hra, kde hráči obchodují, najímají piráty a obchodníky, aby získali co nejvíce bohatství.",
    },
    players: "2-5",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Proroctví",
    language: "CZ",
    duration: 0,
    rating: 0,
    players: "2-5",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Rats of Wistar",
    language: "EN",
    duration: [60, 90],
    rating: 7.5,
    bggLink: "https://boardgamegeek.com/boardgame/343171/rats-wistar",
    description: {
      "en-US": "Strategic game about laboratory experiments on rats.",
      "cs-CZ": "Strategická hra o laboratorních experimentech na krysách.",
    },
    players: "1-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "The Red Cathedral",
    language: "Jazykově nezávislé",
    duration: [60, 90],
    rating: 7.9,
    bggLink: "https://boardgamegeek.com/boardgame/297978/red-cathedral",
    description: {
      "en-US": "Euro game about building a cathedral.",
      "cs-CZ": "Euro hra o budování katedrály.",
    },
    players: "1-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Res Arcana",
    expansions: "Lux et Tenebrae, Perlae Imperii",
    language: "EN",
    duration: [30, 60],
    rating: 8.0,
    bggLink: "https://boardgamegeek.com/boardgame/262712/res-arcana",
    description: {
      "en-US": "Fast strategic game with elements of magic and alchemy.",
      "cs-CZ": "Rychlá strategická hra s prvky magie a alchymie.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Roam",
    language: "Jazykově nezávislé",
    duration: [30, 45],
    rating: 7.3,
    bggLink: "https://boardgamegeek.com/boardgame/269207/roam",
    description: {
      "en-US": "Abstract game about discovering land.",
      "cs-CZ": "Abstraktní hra o objevování země.",
    },
    players: "2-4",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Robinson Crusoe",
    language: "CZ",
    duration: 0,
    rating: 0,
    players: "1-4",
    difficulty: "hard",
    category: "Dungeon Crawler",
  },
  {
    name: "Samurai Sword",
    language: "Jazykově nezávislé",
    duration: [30, 45],
    rating: 7.5,
    bggLink: "https://boardgamegeek.com/boardgame/128181/samurai-sword",
    description: {
      "en-US":
        "Fast card game inspired by Bang!, but set in a samurai environment.",
      "cs-CZ":
        "Rychlá karetní hra inspirovaná hrou Bang!, ale zasazená do samurajského prostředí.",
    },
    players: "3-7",
    difficulty: "easy",
    category: "Party",
  },
  {
    name: "Scythe",
    language: "EN",
    duration: [90, 150],
    rating: 8.2,
    bggLink: "https://boardgamegeek.com/boardgame/169786/scythe",
    description: {
      "en-US":
        "Strategic game about alternate 1920s European history where players control factions with giant robots.",
      "cs-CZ":
        "Strategická hra o alternativní historii Evropy 20. let, kde hráči ovládají frakce s obřími roboty.",
    },
    players: "1-5",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Sea Salt & Paper",
    language: "Jazykově nezávislé",
    duration: [15, 30],
    rating: 7.4,
    bggLink: "https://boardgamegeek.com/boardgame/353691/sea-salt-paper",
    description: {
      "en-US":
        "Fast card game about creating combinations and collecting points.",
      "cs-CZ": "Rychlá karetní hra o vytváření kombinací a sbírání bodů.",
    },
    players: "2-4",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Seasons",
    expansions: "Enchanted Kingdom, Path of Destiny",
    language: "EN",
    duration: 60,
    rating: 7.8,
    bggLink: "https://boardgamegeek.com/boardgame/108745/seasons",
    description: {
      "en-US": "Strategic game with dice management and spell deck building.",
      "cs-CZ": "Strategická hra se správou kostek a budováním balíčku kouzel.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Secret Hitler",
    language: "Jazykově nezávislé",
    duration: 0,
    rating: 0,
    players: "5-10",
    difficulty: "easy",
    category: "Party",
  },
  {
    name: "Seti",
    language: "CZ",
    duration: 0,
    rating: 0,
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Seven Dragons",
    language: "Jazykově nezávislé",
    duration: 20,
    rating: 6.9,
    bggLink: "https://boardgamegeek.com/boardgame/102857/seven-dragons",
    description: {
      "en-US": "Abstract card game about connecting colored dragon cards.",
      "cs-CZ": "Abstraktní karetní hra o spojování barevných dračích karet.",
    },
    players: "2-5",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Shipyard (Second Edition)",
    language: "Jazykově nezávislé",
    duration: [60, 120],
    rating: 7.9,
    bggLink:
      "https://boardgamegeek.com/boardgame/372800/shipyard-second-edition",
    description: {
      "en-US":
        "Euro game about building ships and developing maritime transport.",
      "cs-CZ": "Euro hra o stavbě lodí a rozvoji námořní dopravy.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Sid Meier's Civilization: The Board Game",
    expansions: "Fame and Fortune, Wisdom and Warfare",
    language: "EN",
    duration: [120, 180],
    rating: 8.0,
    bggLink:
      "https://boardgamegeek.com/boardgame/77130/sid-meiers-civilization-board-game",
    description: {
      "en-US":
        "Civilization strategy inspired by the computer game Sid Meier's Civilization.",
      "cs-CZ":
        "Civilizační strategie inspirovaná počítačovou hrou Sid Meier's Civilization.",
    },
    players: "2-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Sleeping Gods",
    expansions: "Distant Skies, Dungeons, Primeval Peril, Tides of Ruin",
    language: "EN",
    duration: [60, 120],
    rating: 8.4,
    bggLink: "https://boardgamegeek.com/boardgame/287954/sleeping-gods",
    description: {
      "en-US": "Adventure campaign game with open world exploration.",
      "cs-CZ": "Dobrodružná kampaňová hra s průzkumem otevřeného světa.",
    },
    players: "1-4",
    difficulty: "medium",
    category: "Dungeon Crawler",
  },
  {
    name: "Spirit Island",
    expansions:
      "Branch & Claw, Feather & Flame, Jagged Earth, Nature Incarnate",
    language: "EN",
    duration: [90, 120],
    rating: 8.5,
    bggLink: "https://boardgamegeek.com/boardgame/162886/spirit-island",
    description: {
      "en-US":
        "Cooperative game where players as island spirits defend their land against colonizers.",
      "cs-CZ":
        "Kooperativní hra, ve které hráči jako duchové ostrova brání svou zemi před kolonizátory.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Stroganov",
    language: "Jazykově nezávislé",
    duration: [60, 90],
    rating: 7.6,
    bggLink: "https://boardgamegeek.com/boardgame/318768/stroganov",
    description: {
      "en-US": "Euro game about Russian Cossacks and their adventures.",
      "cs-CZ": "Euro hra o ruských kozácích a jejich dobrodružstvích.",
    },
    players: "1-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Šestiměstí",
    language: "CZ",
    duration: 0,
    rating: 0,
    players: "2-6",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Take 5",
    language: "Jazykově nezávislé",
    duration: 45,
    rating: 7.3,
    bggLink: "https://boardgamegeek.com/boardgame/432/take-5",
    description: {
      "en-US": "Fast card game about bluffing and planning.",
      "cs-CZ": "Rychlá karetní hra o blafování a plánování.",
    },
    players: "2-10",
    difficulty: "easy",
    category: "Party",
  },
  {
    name: {
      "en-US": "Tank Duel: Enemy in the Crosshairs",
      "cs-CZ": "Tankový Duel",
    },
    language: "CZ",
    duration: [90, 120],
    rating: 8.0,
    bggLink:
      "https://boardgamegeek.com/boardgame/274882/tank-duel-enemy-crosshairs",
    description: {
      "en-US": "Strategic tank game set in World War II.",
      "cs-CZ": "Strategická tanková hra zasazená do druhé světové války.",
    },
    players: "1-8",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Through the Ages: A New Story of Civilization",
    expansions: "New Leaders and Wonders",
    language: "EN",
    duration: 120,
    rating: 8.5,
    bggLink:
      "https://boardgamegeek.com/boardgame/182028/through-ages-new-story-civilization",
    description: {
      "en-US": "Classic civilization strategy about building empires.",
      "cs-CZ": "Klasická civilizační strategie o budování impérií.",
    },
    players: "2-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Trickerion: Collector's Edition",
    language: "EN",
    duration: [120, 180],
    rating: 8.2,
    bggLink:
      "https://boardgamegeek.com/boardgame/163068/trickerion-legends-illusion",
    description: {
      "en-US":
        "Magical worker-placement game about illusionists and performances.",
      "cs-CZ": "Magická worker-placement hra o iluzionistech a představeních.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Tyrants of the Underdark: Board Game",
    language: "EN",
    duration: [60, 90],
    rating: 7.8,
    bggLink: "https://boardgamegeek.com/boardgame/189932/tyrants-underdark",
    description: {
      "en-US": "Deck-building and area control game from the D&D world.",
      "cs-CZ": "Deck-building a area control hra z prostředí D&D světa.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Unconscious Mind - Delux",
    language: "Jazykově nezávislé",
    duration: [90, 120],
    rating: 8.1,
    bggLink: "https://boardgamegeek.com/boardgame/355001/unconscious-mind",
    description: {
      "en-US":
        "Psychological strategic game inspired by Sigmund Freud's theories.",
      "cs-CZ":
        "Psychologická strategická hra inspirovaná teoriemi Sigmunda Freuda.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Underwater Cities",
    expansions:
      "Biodome Promo, MvM Island Facility Promo Card, New Discoveries",
    language: "Jazykově nezávislé",
    duration: [90, 150],
    rating: 8.4,
    bggLink: "https://boardgamegeek.com/boardgame/247763/underwater-cities",
    description: {
      "en-US": "Strategic euro game about building underwater cities.",
      "cs-CZ": "Strategická euro hra o budování podmořských měst.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "The White Castle",
    expansions: "Matcha",
    language: "Jazykově nezávislé",
    duration: [60, 90],
    rating: 7.7,
    bggLink: "https://boardgamegeek.com/boardgame/376466/white-castle",
    description: {
      "en-US": "Euro game about Japanese clans competing for influence.",
      "cs-CZ": "Euro hra o japonských klanech soupeřících o vliv.",
    },
    players: "1-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Vijayanagara: The Deccan Empires of Medieval India, 1290-1398",
    language: "EN",
    rating: 0,
    players: "1-3",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Windmill Valley",
    language: "Jazykově nezávislé",
    duration: [30, 45],
    rating: 7.4,
    bggLink: "https://boardgamegeek.com/boardgame/369482/windmill-valley",
    description: {
      "en-US": "Family game about farming in windy valley.",
      "cs-CZ": "Rodinná hra o hospodaření na větrném údolí.",
    },
    players: "1-4",
    difficulty: "easy",
    category: "Family",
  },
  {
    name: "Wingspan",
    expansions: "European Expansion, Oceania Expansion",
    language: "EN",
    duration: [40, 70],
    rating: 8.1,
    bggLink: "https://boardgamegeek.com/boardgame/266192/wingspan",
    description: {
      "en-US":
        "Strategic game about bird watching with deck-building mechanics.",
      "cs-CZ":
        "Strategická hra o pozorování ptáků s deck-building mechanikami.",
    },
    players: "1-5",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Witchstone",
    language: "Jazykově nezávislé",
    duration: [60, 90],
    rating: 7.8,
    bggLink: "https://boardgamegeek.com/boardgame/312804/witchstone",
    description: {
      "en-US": "Combination game about brewing potions and strategic planning.",
      "cs-CZ": "Kombinační hra o míchání lektvarů a strategickém plánování.",
    },
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Woodcraft",
    language: "Jazykově nezávislé",
    duration: [60, 120],
    rating: 8.0,
    bggLink: "https://boardgamegeek.com/boardgame/366013/woodcraft",
    description: {
      "en-US":
        "Euro game about wood management and handcrafted product manufacturing.",
      "cs-CZ": "Euro hra o správě dřeva a výrobě ručně dělaných produktů.",
    },
    players: "1-4",
    difficulty: "hard",
    category: "Strategic",
  },
  {
    name: "Zkáza na orbitě",
    language: "CZ",
    rating: 0,
    players: "2-4",
    difficulty: "medium",
    category: "Strategic",
  },
  {
    name: "Zaklínač",
    language: "CZ",
    rating: 0,
    players: "2-5",
    difficulty: "medium",
    category: "Dungeon Crawler",
  },
];
