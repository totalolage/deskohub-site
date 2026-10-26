import Link from "next/link";
import { getFaqQuestions } from "@/features/faq";
import { type Locale, m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { Button } from "@/shared/components/ui/button";

/** The FAQ page's questions, answered on the FAQ page itself. */
export function LandingPageFaqTeaserSection({ locale }: { locale: Locale }) {
  return (
    <section
      aria-labelledby="landing-faq-teaser-heading"
      className="bg-[#f4f1ea] text-navy-blue"
    >
      <Container className="grid gap-10 py-20 sm:py-28 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-20">
        <div>
          <h2
            id="landing-faq-teaser-heading"
            className="text-4xl leading-tight text-balance sm:text-5xl"
          >
            {m.landingFaqTeaserTitle({}, { locale })}
          </h2>
          <Button asChild size="lg" caps className="mt-8">
            <Link href={`/${locale}/faq`}>
              {m.landingFaqTeaserLink({}, { locale })}
            </Link>
          </Button>
        </div>
        <ul className="border-t border-navy-blue/18 text-xl leading-snug sm:text-2xl">
          {getFaqQuestions(locale).map((question) => (
            <li key={question} className="border-b border-navy-blue/18 py-5">
              {question}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
