import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { DocumentPage } from "@/shared/components/document-page";
import { getLegalDocument, type LegalDocumentKey } from "../content";

type LegalPageProps = {
  locale: Locale;
  documentKey: LegalDocumentKey;
};

export function LegalPage({ locale, documentKey }: LegalPageProps) {
  const document = getLegalDocument(locale, documentKey);

  return (
    <DocumentPage
      eyebrow={m.legalPageEyebrow({}, { locale })}
      title={document.title}
      lead={document.lead}
      meta={
        <p className="text-sm uppercase tracking-[0.14em] text-navy-blue/46">
          {m.legalPageLastUpdatedLabel({}, { locale })}: {document.updatedAt}
        </p>
      }
    >
      {document.sections.map((section) => (
        <section key={section.heading} className="space-y-3">
          <h2 className="text-2xl leading-tight">{section.heading}</h2>
          <div className="space-y-3 text-base leading-7 text-navy-blue/78">
            {section.body.map((paragraph, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Authored paragraphs are ordered and may repeat verbatim.
              <p key={`${section.heading}-${index}`}>{paragraph}</p>
            ))}
          </div>
        </section>
      ))}
    </DocumentPage>
  );
}
