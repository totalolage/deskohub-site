import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { ContactForm, type ContactFormInitialValues } from "./contact-form";

type ContactPageProps = {
  locale: Locale;
  initialValues?: ContactFormInitialValues;
};

export function ContactPage({ locale, initialValues }: ContactPageProps) {
  return (
    <main className="min-h-screen overflow-x-clip bg-navy-blue text-white">
      <section className="pb-20 pt-28 sm:pb-24 sm:pt-36">
        <Container>
          <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
            <section
              aria-labelledby="contact-details-title"
              className="lg:pt-6"
            >
              <h1
                id="contact-details-title"
                className="text-3xl sm:text-[2.2rem]"
              >
                {m.contactDetailsTitle({}, { locale })}
              </h1>
              <dl className="mt-8 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-5 text-base leading-7 sm:gap-x-6">
                <dt className="text-white/72">
                  {m.contactCompanyLabel({}, { locale })}:
                </dt>
                <dd className="min-w-0 font-bold">
                  {workspaceSiteConstants.brand.legalName}
                </dd>
                <dt className="text-white/72">
                  {m.contactAddressLabel({}, { locale })}:
                </dt>
                <dd className="min-w-0 font-bold">
                  <address className="not-italic">
                    {workspaceSiteConstants.location.address.street},
                    <br />
                    {workspaceSiteConstants.location.address.cityDistrict},{" "}
                    {workspaceSiteConstants.location.address.postalCode}{" "}
                    {workspaceSiteConstants.location.address.city}
                  </address>
                </dd>
                <dt className="text-white/72">
                  {m.contactEmailLabel({}, { locale })}:
                </dt>
                <dd className="min-w-0 font-bold">
                  <a
                    href={`mailto:${workspaceSiteConstants.contact.infoEmail}`}
                    className="wrap-anywhere underline underline-offset-4 transition-colors hover:text-sunset-yellow focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sunset-yellow"
                  >
                    {workspaceSiteConstants.contact.infoEmail}
                  </a>
                </dd>
                <dt className="text-white/72">
                  {m.footerCompanyIdLabel({}, { locale })}:
                </dt>
                <dd className="min-w-0 font-bold">
                  {workspaceSiteConstants.company.identificationNumber}
                </dd>
                <dt className="text-white/72">
                  {m.contactTaxIdLabel({}, { locale })}:
                </dt>
                <dd className="min-w-0 font-bold">
                  {workspaceSiteConstants.company.taxIdentificationNumber}
                </dd>
              </dl>
            </section>
            <ContactForm locale={locale} initialValues={initialValues} />
          </div>
        </Container>
      </section>
    </main>
  );
}
