import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { type Locale, m } from "@/features/i18n";
import {
  coworkReservationPath,
  meetingRoomReservationPath,
} from "@/features/reservation/routes";
import { formatMoney } from "@/shared/money/money";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import type { FaqOccupancyStats } from "./backend/faq-occupancy";

/**
 * The pages an answer links through its tags, by unprefixed path. The page
 * prefixes the visitor's locale; the Markdown links the locale-agnostic URL.
 */
export const faqAnswerLinkPaths = {
  aiAssistants: "/ai-assistants",
  contact: "/contact",
  coworking: "/coworking",
  meetingRoomReservation: meetingRoomReservationPath,
  operatingRules: "/operating-rules",
  pricing: "/pricing",
  reservation: coworkReservationPath,
  terms: "/terms-and-conditions",
  ttrpg: "/ttrpg-room",
} as const;

/** A question on the FAQ page with its answer. */
interface FaqEntry {
  readonly value: string;
  readonly question: string;
  /** Plain text, or a sentence whose tags name `faqAnswerLinkPaths` links. */
  readonly answer: string;
  /** An address answer is marked up as an address. */
  readonly answerKind: "address" | "paragraph";
}

/** A topic on the FAQ page with its questions, in page order. */
export interface FaqGroup {
  readonly value: string;
  readonly title: string;
  readonly entries: ReadonlyArray<FaqEntry>;
}

/** What the FAQ answers depend on beyond their copy. */
export interface FaqFacts {
  /** Last month's occupancy; unknown while Dotypos can't provide it. */
  readonly occupancy: FaqOccupancyStats | undefined;
  /** Private offices can be booked, so the page doesn't say they can't. */
  readonly officesOffered: boolean;
}

/** The FAQ questions the home page previews, answered on the FAQ page. */
export const getFaqQuestions = (locale: Locale) =>
  [
    m.faqQuestionDesks({}, { locale }),
    m.faqQuestionHowItWorks({}, { locale }),
    m.faqQuestionPrice({}, { locale }),
    m.faqQuestionInternet({}, { locale }),
    m.faqQuestionCalls({}, { locale }),
    m.faqQuestionLocation({}, { locale }),
  ] as const;

const paragraph = (
  value: string,
  question: string,
  answer: string
): FaqEntry => ({ value, question, answer, answerKind: "paragraph" });

const busynessEntry = (
  locale: Locale,
  { averageReservationsPerDay, coworkSeatCapacity }: FaqOccupancyStats
) =>
  paragraph(
    "busyness",
    m.faqQuestionBusyness({}, { locale }),
    m.faqAnswerBusyness(
      {
        average: new Intl.NumberFormat(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(averageReservationsPerDay),
        capacity: new Intl.NumberFormat(locale, {
          maximumFractionDigits: 0,
        }).format(coworkSeatCapacity),
      },
      { locale }
    )
  );

/**
 * The FAQ page's topics, questions and answers in `locale`. The busyness
 * question is left out while last month's occupancy is unknown.
 */
export const getFaqGroups = (
  locale: Locale,
  { occupancy, officesOffered }: FaqFacts
): ReadonlyArray<FaqGroup> => {
  const { address } = workspaceSiteConstants.location;
  const until = workspaceSiteConstants.openingHours.openSpaceUsableUntil;
  const dayPrice = (tier: "open-space" | "reserved-desk") =>
    formatMoney(getWorkspaceProductByTier(tier).price, locale);

  return [
    {
      value: "coworking",
      title: m.faqGroupCoworking({}, { locale }),
      entries: [
        paragraph(
          "desks",
          m.faqQuestionDesks({}, { locale }),
          m.faqAnswerDesks({ until }, { locale })
        ),
        paragraph(
          "price",
          m.faqQuestionPrice({}, { locale }),
          m.faqAnswerPrice(
            {
              openSpacePrice: dayPrice("open-space"),
              reservedDeskPrice: dayPrice("reserved-desk"),
            },
            { locale }
          )
        ),
        paragraph(
          "opening-hours",
          m.faqQuestionOpeningHours({}, { locale }),
          m.faqAnswerOpeningHours({ until }, { locale })
        ),
        paragraph(
          "several-days",
          m.faqQuestionSeveralDays({}, { locale }),
          m.faqAnswerSeveralDays({}, { locale })
        ),
        paragraph(
          "coffee",
          m.faqQuestionCoffee({}, { locale }),
          m.faqAnswerCoffee({}, { locale })
        ),
        paragraph(
          "monitors",
          m.faqQuestionMonitors({}, { locale }),
          m.faqAnswerMonitors({}, { locale })
        ),
        paragraph(
          "internet",
          m.faqQuestionInternet({}, { locale }),
          m.faqAnswerInternet({}, { locale })
        ),
        paragraph(
          "food",
          m.faqQuestionFood({}, { locale }),
          m.faqAnswerFood({}, { locale })
        ),
        paragraph(
          "calls",
          m.faqQuestionCalls({}, { locale }),
          m.faqAnswerCalls({}, { locale })
        ),
        ...(occupancy ? [busynessEntry(locale, occupancy)] : []),
      ],
    },
    {
      value: "booking",
      title: m.faqGroupBooking({}, { locale }),
      entries: [
        paragraph(
          "how-it-works",
          m.faqQuestionHowItWorks({}, { locale }),
          m.faqAnswerHowItWorks({}, { locale })
        ),
        paragraph(
          "account",
          m.faqQuestionAccount({}, { locale }),
          m.faqAnswerAccount({}, { locale })
        ),
        paragraph(
          "pin",
          m.faqQuestionPin({}, { locale }),
          m.faqAnswerPin({}, { locale })
        ),
        paragraph(
          "cancellation",
          m.faqQuestionCancellation({}, { locale }),
          m.faqAnswerCancellation({}, { locale })
        ),
        paragraph(
          "sales",
          m.faqQuestionSales({}, { locale }),
          m.faqAnswerSales({}, { locale })
        ),
        paragraph(
          "ai-assistants",
          m.faqQuestionAiAssistants({}, { locale }),
          m.faqAnswerAiAssistants({}, { locale })
        ),
      ],
    },
    {
      value: "rooms-and-events",
      title: m.faqGroupRoomsAndEvents({}, { locale }),
      entries: [
        paragraph(
          "meeting-room",
          m.faqQuestionMeetingRoom({}, { locale }),
          m.faqAnswerMeetingRoom({}, { locale })
        ),
        paragraph(
          "ttrpg",
          m.faqQuestionTtrpg({}, { locale }),
          m.faqAnswerTtrpg({}, { locale })
        ),
        paragraph(
          "events",
          m.faqQuestionEvents({}, { locale }),
          m.faqAnswerEvents({}, { locale })
        ),
        ...(officesOffered
          ? []
          : [
              paragraph(
                "offices",
                m.faqQuestionOffices({}, { locale }),
                m.faqAnswerOffices({}, { locale })
              ),
            ]),
      ],
    },
    {
      value: "location",
      title: m.faqGroupLocation({}, { locale }),
      entries: [
        {
          value: "location",
          question: m.faqQuestionLocation({}, { locale }),
          answer: `${address.street}, ${address.cityDistrict}, ${address.city} ${address.postalCode}`,
          answerKind: "address",
        },
        paragraph(
          "transport",
          m.faqQuestionTransport({}, { locale }),
          m.faqAnswerTransport({}, { locale })
        ),
        paragraph(
          "bar",
          m.faqQuestionBar({}, { locale }),
          m.faqAnswerBar({}, { locale })
        ),
        paragraph(
          "rules",
          m.faqQuestionRules({}, { locale }),
          m.faqAnswerRules({}, { locale })
        ),
      ],
    },
  ];
};
