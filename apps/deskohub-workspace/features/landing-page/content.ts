import type { WorkspaceLocale } from "@/features/i18n";

export type LandingCopy = {
  labels: {
    heroPanelTitle: string;
    heroPanelDescription: string;
    eventsPanelTitle: string;
    teamPerksTitle: string;
    featuredBadge: string;
    barButton: string;
  };
  nav: Array<{ label: string; href: string }>;
  hero: {
    kicker: string;
    title: string;
    subtitle: string;
    primaryCta: string;
    secondaryCta: string;
    highlights: string[];
  };
  split: {
    title: string;
    description: string;
    bar: {
      title: string;
      text: string;
    };
    workspace: {
      title: string;
      text: string;
    };
  };
  ttrpg: {
    title: string;
    text: string;
    features: Array<{ label: string; text: string }>;
    cta: string;
  };
  events: {
    title: string;
    text: string;
    features: string[];
    foodCallout: string;
    cta: string;
  };
  cowork: {
    title: string;
    officeTitle: string;
    officeText: string;
    workstationTitle: string;
    workstationText: string;
  };
  pricing: {
    title: string;
    subtitle: string;
    items: Array<{
      name: string;
      price: string;
      text: string;
      featured?: boolean;
    }>;
  };
  privateOffice: {
    title: string;
    name: string;
    price: string;
    text: string;
    perks: string[];
    meetingRoomNote: string;
  };
  about: {
    title: string;
    paragraphs: string[];
  };
  faq: {
    title: string;
    items: Array<{ question: string; answer: string }>;
    contactTitle: string;
    contactCta: string;
    legal: string;
  };
};

const landingCopyByLocale: Record<WorkspaceLocale, LandingCopy> = {
  "cs-CZ": {
    labels: {
      heroPanelTitle: "Pozice workspace",
      heroPanelDescription:
        "Samoobsluzny setup pro soustredenou praci na Palmovce.",
      eventsPanelTitle: "Samoobsluzny catering flow",
      teamPerksTitle: "Vyhody pro tym",
      featuredBadge: "Doporuceno",
      barButton: "Deskohub Bar",
    },
    nav: [
      { label: "Rozcestnik", href: "#rozcestnik" },
      { label: "TTRPG", href: "#ttrpg" },
      { label: "Eventy", href: "#eventy" },
      { label: "Cowork", href: "#cowork" },
      { label: "Cenik", href: "#cenik" },
      { label: "Kontakt", href: "#kontakt" },
    ],
    hero: {
      kicker: "Deskohub Workspace - Palmovka",
      title:
        "Prvni samoobsluzny workspace, kde se soustredis a vecer zazijes dalsi level.",
      subtitle:
        "Vstup na kod, otevreno 24/7, profi technika a klid na praci. O dvere vedle je Deskohub Bar, kdyz chces prepnut z flow do hry.",
      primaryCta: "Vybrat pass",
      secondaryCta: "Poptat prostor pro akci",
      highlights: [
        "24/7 pristup na unikatni kod",
        "Samoobsluzny rezim bez cekani",
        "Palmovka, 2 minuty od metra",
      ],
    },
    split: {
      title: "Deskohub Universum ma dve strany",
      description:
        "Jasny rozcestnik: vlevo energie baru, vpravo soustredeni workspace. Jedna adresa, dva rezimy dne.",
      bar: {
        title: "Bar - Kde hry ozivaji",
        text: "Party, drinky, otevrena komunita a vecery, kdy se potkavaji hraci, tvurci i zvedavci.",
      },
      workspace: {
        title: "Workspace - Kde se tvori a vitezis",
        text: "Cowork, profi eventy a soukrome herni vypravy v klidnem prostoru, ktery pracuje s tebou.",
      },
    },
    ttrpg: {
      title: "Tvoje pristi vyprava zacina u nas",
      text: "Pronajmi si odhlucnenou zasedacku, ktera se vecer meni v TTRPG svatyni. Zadny obyvak, zadne drobky, jen atmosfera pro tvou druzinu.",
      features: [
        {
          label: "Smart lighting",
          text: "Nastavis barvu i intenzitu svetla podle lokace a nalady kampane.",
        },
        {
          label: "Velky stul",
          text: "Misto pro mapy, figurky, kostky i vsechny tve prirucky.",
        },
        {
          label: "Samoobsluzny bar",
          text: "Drinky a snacky za dvermi, bez cekani na obsluhu.",
        },
      ],
      cta: "Rezervovat termin pro druzinu",
    },
    events: {
      title: "Eventy a workshopy, ktere maji drive",
      text: "Pro 30-60 lidi pripravime multifunkcni prostor, ktery zmenis z coworku na prednaskovy sal behem 10 minut.",
      features: [
        "Variabilni nabytek na koleckach",
        "Profi promitani, ozvuceni a vysokorychlostni internet",
        "Full space rental: 1 500 Kc/hod nebo 12 000 Kc celodenni pronajem (9:00-22:00)",
      ],
      foodCallout:
        "Vse funguje samoobsluzne: chytra lednice, kiosk a rychle obcerstveni. Signature chlebicky od 125 Kc/2 ks, quiche 95 Kc, salat v doze 145 Kc.",
      cta: "Poptat prostor pro akci",
    },
    cowork: {
      title: "Cowork a workspace pro kazdodenni progres",
      officeTitle: "Mesicni kancelar pro 2-3 osoby",
      officeText:
        "Vlastni zakladna na Palmovce s 24/7 pristupem a zazemim Deskohubu v cene. Bez starosti o energie nebo uklid.",
      workstationTitle: "Profi workstationy s licencemi",
      workstationText:
        'Dva 27" monitory, Adobe Creative Cloud a CAD software pripravene. Prijdes s napadem, odchazis s vysledkem.',
    },
    pricing: {
      title: "Cenik passu",
      subtitle:
        "Vyber si rezim podle typu dne. Vsechny passy stavi na samoobsluze, rychlem vstupu na kod a klidnem prostredi.",
      items: [
        {
          name: "Basic Day Pass",
          price: "350 Kc / den",
          text: "Open space misto, vysokorychlostni Wi-Fi a voda z postmixu.",
        },
        {
          name: "Cowork Plus",
          price: "490 Kc / den",
          text: "Pracovni misto + neomezeny Coffee Pass a denni polevka.",
          featured: true,
        },
        {
          name: "Profi Workstation",
          price: "550 Kc / den",
          text: 'Dva 27" monitory, profi licence a neomezena kava.',
        },
        {
          name: "Full Space Rental",
          price: "1 500 Kc / hod",
          text: "Multifunkcni prostor az pro 60 lidi s technikou a barem.",
        },
      ],
    },
    privateOffice: {
      title: "Soukromi pro tebe a tvuj tym",
      name: "Private Office (2-3 osoby)",
      price: "17 500 Kc / mesic",
      text: "Vlastni kancelar na Palmovce s pristupem na kod a neomezenou kavou pro cely tym.",
      perks: [
        "Soukromy prostor bez ruseni",
        "Bez faktur za energie a internet",
        "Zazemi Deskohub Workspace v cene",
      ],
      meetingRoomNote: "V cene mas 5 hodin zasedacky mesicne zdarma.",
    },
    about: {
      title: "O nas - Budujeme Deskohub Universum",
      paragraphs: [
        "Deskohub pro nas neni jen adresa na Palmovce. Je to ekosystem, kde prace, kreativita a odpocinek davaji smysl v jednom dni.",
        "Dopoledne mas klid, technologie a prostor pro soustredeni. Vecer o dvere vedle oziva bar a herni zazitky, ktere jsme vytvorili s prateli pro komunitu.",
        "Spojujeme moderni automatizaci (vstup na kod, samoobsluzny provoz) s lidskym setkanim nad deskovou hrou.",
      ],
    },
    faq: {
      title: "FAQ a kontakt",
      items: [
        {
          question: "Jak to funguje?",
          answer:
            "Vyberes si pass online, prijde ti kod, pipnes u dveri a pracujes nebo hrajes.",
        },
        {
          question: "Kde vas najdu?",
          answer: "2 minuty od metra Palmovka, Praha 8.",
        },
        {
          question: "Co po praci?",
          answer:
            "Stav se ve vedlejsich dverich v Deskohub Baru na drink a stovky deskovych her.",
        },
      ],
      contactTitle: "Chces rezervaci, prohlidku nebo firemni poptavku?",
      contactCta: "Napsat nam",
      legal: "Deskohub Workspace - Vsechna prava vyhrazena.",
    },
  },
  "en-US": {
    labels: {
      heroPanelTitle: "Workspace positioning",
      heroPanelDescription: "Self-service setup for focused work in Palmovka.",
      eventsPanelTitle: "Self-service catering flow",
      teamPerksTitle: "Team perks",
      featuredBadge: "Top",
      barButton: "Deskohub Bar",
    },
    nav: [
      { label: "Split", href: "#rozcestnik" },
      { label: "TTRPG", href: "#ttrpg" },
      { label: "Events", href: "#eventy" },
      { label: "Cowork", href: "#cowork" },
      { label: "Pricing", href: "#cenik" },
      { label: "Contact", href: "#kontakt" },
    ],
    hero: {
      kicker: "Deskohub Workspace - Palmovka",
      title: "The first self-service workspace where focus wins all day.",
      subtitle:
        "24/7 code access, pro gear, and a calm environment for deep work. One door away: Deskohub Bar when your team wants to switch into play mode.",
      primaryCta: "Choose a pass",
      secondaryCta: "Request event space",
      highlights: [
        "24/7 unique code access",
        "Self-service operations without waiting",
        "Palmovka, 2 minutes from metro",
      ],
    },
    split: {
      title: "Deskohub Universum has two sides",
      description:
        "A clear split: Bar energy on one side, Workspace focus on the other. One location, two modes of your day.",
      bar: {
        title: "Bar - Where games come alive",
        text: "Party vibe, drinks, open community, and evenings where players and creators meet.",
      },
      workspace: {
        title: "Workspace - Where you build and win",
        text: "Cowork, pro events, and private campaigns in a calm space built for performance.",
      },
    },
    ttrpg: {
      title: "Your next campaign starts here",
      text: "Book our sound-insulated room that transforms into a TTRPG sanctuary every evening.",
      features: [
        {
          label: "Smart lighting",
          text: "Set color and intensity for every scene, from forests to lava fields.",
        },
        {
          label: "Large table",
          text: "Plenty of room for maps, miniatures, dice, and books.",
        },
        {
          label: "Self-service bar",
          text: "Snacks and drinks right behind the door, no interruptions.",
        },
      ],
      cta: "Reserve a session",
    },
    events: {
      title: "Events and workshops with momentum",
      text: "Host 30-60 people in a flexible room that shifts from cowork setup to lecture hall in 10 minutes.",
      features: [
        "Furniture on wheels for fast room changes",
        "Pro projection, sound, and high-speed internet",
        "Full space rental: CZK 1,500/hour or CZK 12,000 full day (9:00-22:00)",
      ],
      foodCallout:
        "Everything is self-service: smart fridge, kiosk payment, and fast food options for productive events.",
      cta: "Request event setup",
    },
    cowork: {
      title: "Cowork and workspace for everyday progress",
      officeTitle: "Monthly office for 2-3 people",
      officeText:
        "Your own Palmovka base with 24/7 access and full workspace amenities included.",
      workstationTitle: "Pro workstations with licenses",
      workstationText:
        'Dual 27" monitors plus Adobe Creative Cloud and CAD software pre-installed.',
    },
    pricing: {
      title: "Pass pricing",
      subtitle:
        "Choose your day mode. Every option includes self-service access and a calm work setup.",
      items: [
        {
          name: "Basic Day Pass",
          price: "CZK 350 / day",
          text: "Open space desk, high-speed Wi-Fi, and soda fountain water.",
        },
        {
          name: "Cowork Plus",
          price: "CZK 490 / day",
          text: "Desk + unlimited batch brew coffee pass and daily soup.",
          featured: true,
        },
        {
          name: "Profi Workstation",
          price: "CZK 550 / day",
          text: 'Dual 27" monitors, pro software licenses, and unlimited coffee.',
        },
        {
          name: "Full Space Rental",
          price: "CZK 1,500 / hour",
          text: "Flexible event space for up to 60 people with AV and bar access.",
        },
      ],
    },
    privateOffice: {
      title: "Privacy for your team",
      name: "Private Office (2-3 people)",
      price: "CZK 17,500 / month",
      text: "Private office with code access and unlimited coffee for your whole team.",
      perks: [
        "Quiet private room",
        "No extra utility or internet invoices",
        "Workspace amenities included",
      ],
      meetingRoomNote: "Includes 5 free meeting room hours every month.",
    },
    about: {
      title: "About us - We are building Deskohub Universum",
      paragraphs: [
        "Deskohub is not just an address in Palmovka. It is an ecosystem where work, creativity, and play can coexist.",
        "Mornings are for focus, technology, and production. Evenings continue one door away in our board game bar built with friends for community.",
        "We combine modern automation (code access, self-service flow) with real human connection around games.",
      ],
    },
    faq: {
      title: "FAQ and contact",
      items: [
        {
          question: "How does it work?",
          answer:
            "Pick a pass online, get your code, tap in at the door, and start working or playing.",
        },
        {
          question: "Where are you located?",
          answer: "Two minutes from Palmovka metro, Prague 8.",
        },
        {
          question: "What about after work?",
          answer:
            "Step next door into Deskohub Bar for drinks and hundreds of board games.",
        },
      ],
      contactTitle: "Need a booking, tour, or team setup?",
      contactCta: "Contact us",
      legal: "Deskohub Workspace - All rights reserved.",
    },
  },
};

export function getLandingCopy(locale: WorkspaceLocale): LandingCopy {
  return landingCopyByLocale[locale];
}
