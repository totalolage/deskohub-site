import Interpolate from "@doist/react-interpolate";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { textLink } from "@/shared/components/ui/text-link";
import {
  type FaqFacts,
  faqAnswerLinkPaths,
  getFaqGroups,
} from "../faq-entries";

type FaqPageProps = FaqFacts & {
  locale: Locale;
};

export function FaqPage({ locale, ...facts }: FaqPageProps) {
  const groups = getFaqGroups(locale, facts);
  const answerLinks = Object.fromEntries(
    Object.entries(faqAnswerLinkPaths).map(([tag, path]) => [
      tag,
      (content: ReactNode) => (
        <Link
          href={`/${locale}${path}`}
          className={textLink({ tone: "inverse" })}
        >
          {content}
        </Link>
      ),
    ])
  );

  return (
    <main className="min-h-dvh overflow-x-clip bg-[linear-gradient(180deg,#05083f_0%,#0d1258_45%,#15123e_100%)] pb-20 pt-[calc(var(--site-header-height)+4rem)] text-white sm:pb-24 sm:pt-[calc(var(--site-header-height)+5rem)]">
      <Container className="max-w-4xl">
        <h1 className="text-4xl leading-tight text-balance sm:text-5xl">
          {m.faqPageTitle({}, { locale })}
        </h1>

        {groups.map((group) => (
          <section
            aria-labelledby={`faq-${group.value}`}
            className="mt-14 first-of-type:mt-10"
            key={group.value}
          >
            <h2
              className="text-2xl text-sunset-yellow sm:text-3xl"
              id={`faq-${group.value}`}
            >
              {group.title}
            </h2>
            <div className="mt-4 divide-y divide-white/14 border-y border-white/14">
              {group.entries.map((item) => (
                <details key={item.value} className="group py-1">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chilean-fire focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1258]">
                    <h3 className="text-base font-semibold text-white sm:text-lg">
                      {item.question}
                    </h3>
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
                      <p>
                        <Interpolate
                          string={item.answer}
                          mapping={answerLinks}
                        />
                      </p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </Container>
    </main>
  );
}
