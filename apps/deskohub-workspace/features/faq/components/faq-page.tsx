import { ChevronDown } from "lucide-react";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { getFaqEntries } from "../faq-entries";

type FaqPageProps = {
  locale: Locale;
  averageReservationsPerDay: number;
  coworkSeatCapacity: number;
};

export function FaqPage({
  locale,
  averageReservationsPerDay,
  coworkSeatCapacity,
}: FaqPageProps) {
  const entries = getFaqEntries(locale, {
    averageReservationsPerDay,
    coworkSeatCapacity,
  });

  return (
    <main className="min-h-dvh overflow-x-clip bg-[linear-gradient(180deg,#05083f_0%,#0d1258_45%,#15123e_100%)] pb-20 pt-[calc(var(--site-header-height)+4rem)] text-white sm:pb-24 sm:pt-[calc(var(--site-header-height)+5rem)]">
      <Container className="max-w-4xl">
        <h1 className="text-4xl leading-tight text-balance sm:text-5xl">
          {m.faqPageTitle({}, { locale })}
        </h1>

        <div className="mt-8 divide-y divide-white/14">
          {entries.map((item) => (
            <details key={item.value} className="group py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chilean-fire focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1258]">
                <h2 className="text-base font-semibold text-white sm:text-lg">
                  {item.question}
                </h2>
                <ChevronDown
                  aria-hidden="true"
                  className="size-5 shrink-0 text-burned-orange transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <div className="pb-5 text-base leading-8 text-white/76">
                {item.answerKind === "address" ? (
                  <address className="not-italic leading-8 text-white/76">
                    {item.answer}
                  </address>
                ) : (
                  <p>{item.answer}</p>
                )}
              </div>
            </details>
          ))}
        </div>
      </Container>
    </main>
  );
}
