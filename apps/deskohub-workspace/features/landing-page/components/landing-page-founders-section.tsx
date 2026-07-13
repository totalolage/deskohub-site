import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { CensoredFounderName } from "./censored-founder-name";
import { FounderProfileImage } from "./founder-profile-image";

type LandingPageFoundersSectionProps = {
  locale: Locale;
  foundersSectionId: string;
};

export function LandingPageFoundersSection({
  locale,
  foundersSectionId,
}: LandingPageFoundersSectionProps) {
  const founders = [
    {
      imagePublicId: "founder-profile-danica",
      imageVersion: 1783848283,
      name: "Danica",
      role: m.landingFounderDanicaRole({}, { locale }),
      description: m.landingFounderDanicaDescription({}, { locale }),
    },
    {
      imagePublicId: "founder-profile-filip",
      imageVersion: 1783848282,
      name: "Filip",
      role: m.landingFounderFilipRole({}, { locale }),
      description: m.landingFounderFilipDescription({}, { locale }),
    },
    {
      imagePublicId: "founder-profile-carp",
      imageVersion: 1783848283,
      name: null,
      role: m.landingFounderHardwareRole({}, { locale }),
      description: m.landingFounderHardwareDescription({}, { locale }),
    },
  ];

  return (
    <section
      id={foundersSectionId}
      className="relative overflow-hidden bg-navy-blue py-20 text-white sm:py-24"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_8%_18%,rgba(236,164,35,0.22),transparent_23%),radial-gradient(circle_at_91%_81%,rgba(0,223,153,0.18),transparent_24%)]"
      />
      <div
        aria-hidden="true"
        className="absolute -right-24 top-20 h-72 w-72 rotate-12 rounded-[4rem] border-[1.5rem] border-white/5"
      />

      <Container className="relative z-10">
        <div className="max-w-3xl">
          <h2 className="text-4xl leading-tight text-balance sm:text-5xl">
            {m.landingFoundersTitle({}, { locale })}
          </h2>
        </div>

        <div className="mt-10 grid max-w-4xl gap-8 xl:mt-12">
          {founders.map((founder) => (
            <article key={founder.role} className="relative overflow-visible">
              <div className="relative flex min-h-28 items-stretch sm:min-h-40">
                <div className="relative z-10 w-28 shrink-0 self-stretch sm:w-40">
                  <div className="absolute top-1/2 h-28 w-28 -translate-y-1/2 overflow-hidden rounded-full border-4 border-white bg-navy-blue shadow-[0_16px_32px_-18px_rgba(0,2,79,0.72)] sm:h-40 sm:w-40">
                    <FounderProfileImage
                      publicId={founder.imagePublicId}
                      version={founder.imageVersion}
                    />
                  </div>

                  <div className="absolute left-[calc(100%+1rem)] top-5 z-10 sm:top-6">
                    {founder.name ? (
                      <div className="w-fit rounded-full border border-burned-orange/30 bg-burned-orange px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-white shadow-[0_2px_4px_rgba(221,72,10,0.38)]">
                        {founder.name}
                      </div>
                    ) : (
                      <div className="w-max whitespace-nowrap rounded-full border border-burned-orange/30 bg-burned-orange px-3 py-1 leading-none shadow-[0_2px_4px_rgba(221,72,10,0.38)]">
                        <CensoredFounderName className="text-xs tracking-[0.16em] drop-shadow-none" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="relative -ml-14 min-w-0 flex-1 rounded-[1.5rem] border border-navy-blue/18 bg-white/90 px-5 pb-5 pl-18 pt-14 text-navy-blue shadow-[0_20px_40px_-28px_rgba(0,2,79,0.38)] sm:-ml-20 sm:px-6 sm:pb-6 sm:pl-24 sm:pt-16">
                  <h3 className="text-2xl leading-tight sm:text-3xl">
                    {founder.role}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-navy-blue/72 sm:mt-3 sm:leading-7">
                    {founder.description}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
