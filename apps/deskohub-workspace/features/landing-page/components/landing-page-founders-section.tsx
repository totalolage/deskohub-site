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

        <div className="mt-10 grid gap-8 md:grid-cols-2 md:gap-6 xl:mt-12 xl:grid-cols-3">
          {founders.map((founder) => (
            <article
              key={founder.role}
              className="group relative overflow-visible md:overflow-hidden md:rounded-[2rem] md:border md:border-navy-blue/10 md:bg-white md:shadow-[0_28px_76px_-48px_rgba(0,2,79,0.6)]"
            >
              <div className="relative flex min-h-24 items-stretch md:block md:min-h-0">
                <div className="relative z-10 w-24 shrink-0 self-stretch md:aspect-[3/4] md:w-full md:self-auto md:z-auto">
                  <div className="absolute top-1/2 h-24 w-24 -translate-y-1/2 overflow-hidden rounded-full border-4 border-white/70 bg-navy-blue shadow-[0_16px_32px_-18px_rgba(0,2,79,0.9)] md:inset-0 md:h-auto md:w-auto md:translate-y-0 md:rounded-none md:border-0 md:shadow-none">
                    <FounderProfileImage
                      publicId={founder.imagePublicId}
                      version={founder.imageVersion}
                    />

                    <div className="absolute inset-0 hidden bg-[radial-gradient(ellipse_100%_62%_at_50%_33%,transparent_0%,transparent_50%,rgba(216,216,216,0.28)_100%)] md:block" />
                  </div>

                  <div className="absolute left-[calc(100%+1rem)] top-5 z-10 whitespace-nowrap md:inset-x-0 md:bottom-0 md:top-auto md:p-6">
                    {founder.name ? (
                      <p className="text-lg font-medium tracking-wide text-white drop-shadow-[0_2px_4px_rgba(0,2,79,0.9)]">
                        {founder.name}
                      </p>
                    ) : (
                      <CensoredFounderName />
                    )}
                  </div>
                </div>

                <div className="relative -ml-12 min-w-0 flex-1 rounded-r-[1.5rem] border-y border-r border-white/65 px-5 pb-5 pl-16 pt-14 text-white md:ml-0 md:block md:min-h-0 md:rounded-none md:border-0 md:bg-white md:p-6 md:text-navy-blue">
                  <h3 className="text-2xl leading-tight md:text-3xl">
                    {founder.role}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-white/80 md:mt-3 md:leading-7 md:text-navy-blue/74">
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
