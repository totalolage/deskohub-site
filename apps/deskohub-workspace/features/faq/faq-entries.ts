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

/** The FAQ page's questions in page order, for previews of the page. */
export const getFaqQuestions = (locale: Locale) =>
  [
    m.faqQuestionLocation({}, { locale }),
    m.faqQuestionHowItWorks({}, { locale }),
    m.faqQuestionInternet({}, { locale }),
    m.faqQuestionFood({}, { locale }),
    m.faqQuestionCalls({}, { locale }),
    m.faqQuestionBusyness({}, { locale }),
  ] as const;

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
  const [location, howItWorks, internet, food, calls, busyness] =
    getFaqQuestions(locale);

  return [
    {
      value: "location",
      question: location,
      answer: `${address.street}, ${address.cityDistrict}, ${address.city} ${address.postalCode}`,
      answerKind: "address",
    },
    {
      value: "how-it-works",
      question: howItWorks,
      answer: m.faqAnswerHowItWorks({}, { locale }),
      answerKind: "paragraph",
    },
    {
      value: "internet",
      question: internet,
      answer: m.faqAnswerInternet({}, { locale }),
      answerKind: "paragraph",
    },
    {
      value: "food",
      question: food,
      answer: m.faqAnswerFood({}, { locale }),
      answerKind: "paragraph",
    },
    {
      value: "calls",
      question: calls,
      answer: m.faqAnswerCalls({}, { locale }),
      answerKind: "paragraph",
    },
    {
      value: "busyness",
      question: busyness,
      answer: m.faqAnswerBusyness({ average, capacity }, { locale }),
      answerKind: "paragraph",
    },
  ];
};
