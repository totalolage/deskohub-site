import { m } from "@/features/i18n";

export type ScheduleItem = {
  title: string;
  time: string;
  description: string;
  note?: string;
  imagePublicId: string;
  cta?: {
    href: string;
    label: string;
  };
};

export const getSchedule = (): ScheduleItem[] => [
  {
    title: m["palmovcon2026.schedule.miniaturePainting.title"](),
    time: m["palmovcon2026.schedule.miniaturePainting.time"](),
    description: m["palmovcon2026.schedule.miniaturePainting.description"](),
    imagePublicId: "palmovcon-event-miniature-painting",
  },
  {
    title: m["palmovcon2026.schedule.witcher.title"](),
    time: m["palmovcon2026.schedule.witcher.time"](),
    description: m["palmovcon2026.schedule.witcher.description"](),
    imagePublicId: "palmovcon-event-witcher-game",
    cta: {
      href: "https://forms.gle/BnmwtDu5gqLx1VWVA",
      label: m["palmovcon2026.registrationCta"](),
    },
  },
  {
    title: m["palmovcon2026.schedule.saltyFrogs.title"](),
    time: m["palmovcon2026.schedule.saltyFrogs.time"](),
    description: m["palmovcon2026.schedule.saltyFrogs.description"](),
    note: m["palmovcon2026.schedule.saltyFrogs.note"](),
    imagePublicId: "palmovcon-event-salty-frogs-goblins",
    cta: {
      href: "https://forms.gle/yek7zh4nrE8NWJRd7",
      label: m["palmovcon2026.registrationCta"](),
    },
  },
  {
    title: m["palmovcon2026.schedule.bloodOnTheClocktower.title"](),
    time: m["palmovcon2026.schedule.bloodOnTheClocktower.time"](),
    description: m["palmovcon2026.schedule.bloodOnTheClocktower.description"](),
    cta: {
      // Reenio link verified in production; the date-looking segment is expected.
      href: "https://clocktower-v-praze.reenio.cz/cs/term/2026-07-18/2026-06-30;hideResources=1;hideCalendar=1",
      label: m["palmovcon2026.registrationCta"](),
    },
    imagePublicId: "palmovcon-event-blood-on-the-clocktower",
  },
  {
    title: m["palmovcon2026.schedule.bazaar.title"](),
    time: m["palmovcon2026.schedule.bazaar.time"](),
    description: m["palmovcon2026.schedule.bazaar.description"](),
    imagePublicId: "palmovcon-event-boardgame-bazar",
  },
  {
    title: m["palmovcon2026.schedule.cardTournaments.title"](),
    time: m["palmovcon2026.schedule.cardTournaments.time"](),
    description: m["palmovcon2026.schedule.cardTournaments.description"](),
    note: m["palmovcon2026.schedule.cardTournaments.note"](),
    imagePublicId: "palmovcon-event-card-tournaments",
    cta: {
      href: "https://forms.gle/q6xBYG5ZRy89wxCV9",
      label: m["palmovcon2026.registrationCta"](),
    },
  },
];
