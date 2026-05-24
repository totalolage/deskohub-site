import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { getLegalDocument, type LegalDocumentKey } from "../content";

type LegalPageProps = {
  locale: Locale;
  documentKey: LegalDocumentKey;
};

export function LegalPage({ locale, documentKey }: LegalPageProps) {
  const document = getLegalDocument(locale, documentKey);

  return (
    <main className="min-h-screen overflow-x-clip bg-[#f4f1ea] text-navy-blue">
      <section className="relative isolate overflow-hidden pb-20 pt-28 sm:pb-24 sm:pt-36">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(236,164,35,0.18),transparent_28%),radial-gradient(circle_at_right,rgba(0,223,153,0.1),transparent_26%),linear-gradient(180deg,#08154a_0%,#10205a_30%,#f4f1ea_30%,#f4f1ea_100%)]" />

        <Container>
          <div className="mx-auto max-w-4xl rounded-[2rem] border border-white/60 bg-white/92 p-8 shadow-[0_40px_120px_-52px_rgba(0,2,79,0.55)] backdrop-blur-sm sm:p-12">
            <div className="space-y-5">
              <div className="inline-flex rounded-full border border-navy-blue/10 bg-navy-blue/4 px-4 py-2 text-[0.72rem] uppercase tracking-[0.18em] text-burned-orange">
                {m.legalPageEyebrow({}, { locale })}
              </div>
              <h1 className="text-balance text-4xl leading-none sm:text-5xl">
                {document.title}
              </h1>
              <p className="max-w-3xl text-base leading-7 text-navy-blue/72 sm:text-lg">
                {document.lead}
              </p>
              <p className="text-sm uppercase tracking-[0.14em] text-navy-blue/46">
                {m.legalPageLastUpdatedLabel({}, { locale })}:{" "}
                {document.updatedAt}
              </p>
            </div>

            <div className="mt-10 space-y-8">
              {document.sections.map((section) => (
                <section key={section.heading} className="space-y-3">
                  <h2 className="text-2xl leading-tight">{section.heading}</h2>
                  <div className="space-y-3 text-base leading-7 text-navy-blue/78">
                    {section.body.map((paragraph, index) => (
                      <p key={`${section.heading}-${index}`}>{paragraph}</p>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </Container>
      </section>
    </main>
  );
}
