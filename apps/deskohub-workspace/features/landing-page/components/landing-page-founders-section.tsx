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

        <div className="mt-10 grid gap-6 md:grid-cols-2 xl:mt-12 xl:grid-cols-3">
          {founders.map((founder) => (
            <article
              key={founder.role}
              className="group overflow-hidden rounded-[2rem] border border-navy-blue/10 bg-white shadow-[0_28px_76px_-48px_rgba(0,2,79,0.6)]"
            >
              <div className="relative aspect-[3/4] overflow-hidden bg-navy-blue">
                <FounderProfileImage
                  publicId={founder.imagePublicId}
                  version={founder.imageVersion}
                />

                <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_62%_at_50%_33%,transparent_0%,transparent_50%,rgba(216,216,216,0.28)_100%)]" />
                <div className="absolute inset-x-0 bottom-0 p-6">
                  {founder.name ? (
                    <p className="text-lg font-medium tracking-wide text-white drop-shadow-[0_2px_4px_rgba(0,2,79,0.9)]">
                      {founder.name}
                    </p>
                  ) : (
                    <CensoredFounderName />
                  )}
                </div>
              </div>

              <div className="p-6">
                <h3 className="text-3xl leading-tight text-navy-blue">
                  {founder.role}
                </h3>
                <p className="mt-3 text-sm leading-7 text-navy-blue/74">
                  {founder.description}
                </p>
              </div>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
