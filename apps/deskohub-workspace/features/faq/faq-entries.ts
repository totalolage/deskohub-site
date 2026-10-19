import { type Locale, m } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import type { FaqOccupancyStats } from "./backend/faq-occupancy";

/** A question on the FAQ page with its answer, in page order. */
export interface FaqEntry {
  readonly value: string;
  readonly question: string;
  readonly answer: string;
  /** An address answer is marked up as an address. */
  readonly answerKind: "address" | "paragraph";
}

/** The FAQ page's questions and answers in `locale`. */
export const getFaqEntries = (
  locale: Locale,
  occupancy: FaqOccupancyStats
): ReadonlyArray<FaqEntry> => {
  const address = workspaceSiteConstants.location.address;
  const average = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(occupancy.averageReservationsPerDay);
  const capacity = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(occupancy.coworkSeatCapacity);

  return [
    {
      value: "location",
      question: m.faqQuestionLocation({}, { locale }),
      answer: `${address.street}, ${address.cityDistrict}, ${address.city} ${address.postalCode}`,
      answerKind: "address",
    },
    {
      value: "how-it-works",
      question: m.faqQuestionHowItWorks({}, { locale }),
      answer: m.faqAnswerHowItWorks({}, { locale }),
      answerKind: "paragraph",
    },
    {
      value: "internet",
      question: m.faqQuestionInternet({}, { locale }),
      answer: m.faqAnswerInternet({}, { locale }),
      answerKind: "paragraph",
    },
    {
      value: "food",
      question: m.faqQuestionFood({}, { locale }),
      answer: m.faqAnswerFood({}, { locale }),
      answerKind: "paragraph",
    },
    {
      value: "calls",
      question: m.faqQuestionCalls({}, { locale }),
      answer: m.faqAnswerCalls({}, { locale }),
      answerKind: "paragraph",
    },
    {
      value: "busyness",
      question: m.faqQuestionBusyness({}, { locale }),
      answer: m.faqAnswerBusyness({ average, capacity }, { locale }),
      answerKind: "paragraph",
    },
  ];
};
