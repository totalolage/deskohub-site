import { m, type WorkspaceLocale } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { Section } from "@/shared/components/section";
import { SiteHeader } from "@/shared/components/site-header";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { ImageWithFallback } from "@/shared/components/ui/image-with-fallback";
import { cn, workspaceSiteConstants } from "@/shared/utils";
import heroImage from "../images/hero.jpeg";
import userJourney1 from '../images/onboarding-1.png';
import userJourney2 from '../images/onboarding-2.png';
import userJourney3 from '../images/onboarding-3.png';
import userJourney4 from '../images/onboarding-4.png';

type LandingPageProps = {
  locale: WorkspaceLocale;
};

export function LandingPage({ locale }: LandingPageProps) {
  const localePath = `/${locale}`;
  const navItems = [
    { label: m.landingNavTtrpg(), href: "#ttrpg" },
    { label: m.landingNavEvents(), href: "#eventy" },
    { label: m.landingNavCowork(), href: "#cowork" },
    { label: m.landingNavPricing(), href: "#cenik" },
    { label: m.landingNavPrivateOffice(), href: "#office" },
    // { label: m.landingNavUniversum(), href: "#about" },
    { label: m.landingNavFaqContact(), href: "#kontakt" },
  ];
  if (locale === "en-US") {
    navItems.unshift({
      label: m.landingNavOverview(),
      href: "#rozcestnik",
    });
  }

  const languageLabels = {
    "en-US": m.languageEnglish(),
    "cs-CZ": m.languageCzech(),
  } satisfies Record<WorkspaceLocale, string>;

  const navLinks = navItems.map((item) => ({
    label: item.label,
    href: `${localePath}${item.href}`,
  }));
  const localizedHash = (hash: string) => `${localePath}${hash}`;
  const heroHighlights = [
    m.landingHeroHighlightOne(),
    m.landingHeroHighlightTwo(),
    m.landingHeroHighlightThree(),
  ];
  const ttrpgFeatures = [
    {
      label: m.landingTtrpgFeatureOneLabel(),
      text: m.landingTtrpgFeatureOneText(),
    },
    {
      label: m.landingTtrpgFeatureTwoLabel(),
      text: m.landingTtrpgFeatureTwoText(),
    },
    {
      label: m.landingTtrpgFeatureThreeLabel(),
      text: m.landingTtrpgFeatureThreeText(),
    },
  ];
  const eventFeatures = [
    m.landingEventsFeatureOne(),
    m.landingEventsFeatureTwo(),
    m.landingEventsFeatureThree(),
  ];
  const pricingItems = [
    {
      name: m.landingPricingItemOneName(),
      price: m.landingPricingItemOnePrice(),
      text: m.landingPricingItemOneText(),
    },
    {
      name: m.landingPricingItemTwoName(),
      price: m.landingPricingItemTwoPrice(),
      text: m.landingPricingItemTwoText(),
      featured: true,
    },
    {
      name: m.landingPricingItemThreeName(),
      price: m.landingPricingItemThreePrice(),
      text: m.landingPricingItemThreeText(),
    },
    {
      name: m.landingPricingItemFourName(),
      price: m.landingPricingItemFourPrice(),
      text: m.landingPricingItemFourText(),
    },
  ];
  const privateOfficePerks = [
    m.landingPrivateOfficePerkOne(),
    m.landingPrivateOfficePerkTwo(),
    m.landingPrivateOfficePerkThree(),
  ];
  const universumParagraphs = [
    m.landingUniversumParagraphOne(),
    m.landingUniversumParagraphTwo(),
    m.landingUniversumParagraphThree(),
  ];
  const faqItems = [
    {
      question: m.landingFaqItemOneQuestion(),
      answer: m.landingFaqItemOneAnswer(),
    },
    {
      question: m.landingFaqItemTwoQuestion(),
      answer: m.landingFaqItemTwoAnswer(),
    },
    {
      question: m.landingFaqItemThreeQuestion(),
      answer: m.landingFaqItemThreeAnswer(),
    },
  ];

  return (
    <>
      <SiteHeader
        locale={locale}
        languageSwitcherPath={localePath}
        languageLabels={languageLabels}
        links={navLinks}
        contactLabel={m.landingNavContactLabel()}
      />

      <main className="overflow-hidden">
        <Section className="relative pt-10 sm:pt-14 text-white min-h-[80vh]">
          <ImageWithFallback
            src={heroImage}
            alt="hero"
            className="w-full absolute inset-0 -z-1 blur-xs scale-110 origin-bottom contrast-125"
            fill
          />
          <div className={cn(
            "absolute inset-0 -z-1",
            "bg-[radial-gradient(circle_at_68%_30%,rgba(0,0,0,0.5)_0%,rgba(0,0,0,1)_100%)]"
            // 'bg-[rgba(0,0,0,0.5)]'
          )}/>
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] items-center">
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
              <h1 className="mt-5 max-w-4xl text-4xl leading-tight sm:text-5xl lg:text-6xl text-white/85">
                {m.landingHeroTitle()}
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed">
                {m.landingHeroSubtitle()}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild>
                  <a href={localizedHash("#cenik")}>
                    {m.landingHeroPrimaryCta()}
                  </a>
                </Button>
                <Button asChild variant="secondary">
                  <a href={localizedHash("#eventy")}>
                    {m.landingHeroSecondaryCta()}
                  </a>
                </Button>
              </div>
              <ul className="mt-8 grid gap-2 sm:grid-cols-3">
                {heroHighlights.map((highlight) => (
                  <li
                    key={highlight}
                    className="rounded-xl border border-navy-blue/15 bg-white/80 px-3 py-2 text-sm text-navy-blue/85"
                  >
                    {highlight}
                  </li>
                ))}
              </ul>
            </div>

            <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000 max-w-2xl">
              <div className="grid grid-cols-3 pt-8">
                <ImageWithFallback className="translate-x-8" src={userJourney1} alt="User journey purchase entry" width={120} />
                <ImageWithFallback className="pt-6" src={userJourney2} alt="User journey recieve code" height={180}/>
                <ImageWithFallback className="-translate-x-12 pt-12" src={userJourney3} alt="User journey enter workspace" width={200} />
                <ImageWithFallback className="col-span-3 justify-self-center" src={userJourney4} alt="User journey do work" height={300}/>
              </div>
            </div>
          </div>
        </Section>

        <Section id="rozcestnik" className="py-16 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <h2 className="text-3xl sm:text-4xl">
                {m.landingRozcestnikTitle()}
              </h2>
              <p className="mt-4 max-w-2xl text-navy-blue/80">
                {m.landingRozcestnikDescription()}
              </p>
            </div>
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <Card className="bg-[linear-gradient(150deg,#fff4e8,#ffffff)]">
              <CardHeader>
                <CardTitle>{m.landingRozcestnikBarTitle()}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-navy-blue/85">
                  {m.landingRozcestnikBarText()}
                </p>
              </CardContent>
            </Card>
            <Card className="border-aquamarine-green/35 bg-[linear-gradient(145deg,#ecfff8,#ffffff)]">
              <CardHeader>
                <CardTitle>{m.landingRozcestnikWorkspaceTitle()}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-navy-blue/85">
                  {m.landingRozcestnikWorkspaceText()}
                </p>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="ttrpg" className="bg-navy-blue py-16 text-silver sm:py-20">
          <div className="grid gap-7 lg:grid-cols-[1.08fr_0.92fr]">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-sunset-yellow">
                {m.landingTtrpgSectionLabel()}
              </p>
              <h2 className="mt-3 text-3xl text-white sm:text-4xl">
                {m.landingTtrpgTitle()}
              </h2>
              <p className="mt-4 text-silver/90">{m.landingTtrpgText()}</p>
              <p className="mt-4 rounded-xl border border-silver/20 bg-white/5 px-4 py-3 text-sm text-silver/90">
                {m.landingTtrpgDetail()}
              </p>
              <Button
                asChild
                className="mt-6 bg-white text-navy-blue hover:bg-white/90"
              >
                <a href={localizedHash("#kontakt")}>{m.landingTtrpgCta()}</a>
              </Button>
            </div>
            <div className="grid gap-3">
              {ttrpgFeatures.map((feature) => (
                <Card
                  key={feature.label}
                  className="border-silver/20 bg-white/5 text-silver shadow-none"
                >
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      {feature.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-silver/85">{feature.text}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </Section>

        <Section id="eventy" className="py-16 sm:py-20">
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-burned-orange">
                {m.landingEventsSectionLabel()}
              </p>
              <h2 className="mt-3 text-3xl sm:text-4xl">
                {m.landingEventsTitle()}
              </h2>
              <p className="mt-4 text-navy-blue/85">{m.landingEventsText()}</p>
              <ul className="mt-5 space-y-2 text-sm text-navy-blue/85">
                {eventFeatures.map((item) => (
                  <li
                    key={item}
                    className="rounded-xl border border-navy-blue/10 bg-white px-4 py-3"
                  >
                    {item}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6">
                <a href={localizedHash("#kontakt")}>{m.landingEventsCta()}</a>
              </Button>
            </div>
            <div className="grid gap-4">
              <Card className="border-burned-orange/25 bg-[linear-gradient(145deg,#fff7f0,#ffffff)]">
                <CardHeader>
                  <CardTitle>{m.landingUiEventsCateringTitle()}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-navy-blue/85">
                    {m.landingEventsFoodCallout()}
                  </p>
                </CardContent>
              </Card>
              <Card className="border-navy-blue/20 bg-navy-blue text-silver">
                <CardHeader>
                  <CardTitle className="text-white">
                    {m.landingEventsFullSpaceRentalTitle()}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-silver/90">
                    {m.landingEventsFullSpaceRentalDetail()}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </Section>

        <Section id="cowork" className="bg-silver/18 py-16 sm:py-20">
          <p className="text-xs uppercase tracking-[0.16em] text-burned-orange">
            {m.landingCoworkSectionLabel()}
          </p>
          <h2 className="mt-3 text-3xl sm:text-4xl">
            {m.landingCoworkTitle()}
          </h2>
          <div className="mt-7 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{m.landingCoworkOfficeTitle()}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-navy-blue/85">
                  {m.landingCoworkOfficeText()}
                </p>
              </CardContent>
            </Card>
            <Card className="border-aquamarine-green/25 bg-[linear-gradient(145deg,#f2fff9,#ffffff)]">
              <CardHeader>
                <CardTitle>{m.landingCoworkWorkstationTitle()}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-navy-blue/85">
                  {m.landingCoworkWorkstationText()}
                </p>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="cenik" className="py-16 sm:py-20">
          <h2 className="text-3xl sm:text-4xl">{m.landingPricingTitle()}</h2>
          <p className="mt-4 max-w-3xl text-navy-blue/80">
            {m.landingPricingSubtitle()}
          </p>
          <div className="mt-8 grid gap-4 lg:grid-cols-4">
            {pricingItems.map((item) => (
              <Card
                key={item.name}
                className={cn(
                  "relative",
                  item.featured &&
                    "border-burned-orange/35 bg-[linear-gradient(145deg,#fff8f3,#ffffff)] shadow-[0_24px_56px_-30px_rgba(221,72,10,0.55)]"
                )}
              >
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-lg">{item.name}</CardTitle>
                    {item.featured && (
                      <Badge
                        variant="emphasis"
                        className="absolute -right-2 -top-2"
                      >
                        {m.landingPricingFeaturedBadge()}
                      </Badge>
                    )}
                  </div>
                  <CardDescription>{item.price}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-navy-blue/85">{item.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>

        <Section
          id="office"
          className="bg-navy-blue py-16 text-silver sm:py-20"
        >
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-start">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-sunset-yellow">
                {m.landingPrivateOfficeSectionLabel()}
              </p>
              <h2 className="mt-3 text-3xl text-white sm:text-4xl">
                {m.landingPrivateOfficeTitle()}
              </h2>
              <p className="mt-4 text-xl text-sunset-yellow">
                {m.landingPrivateOfficeName()}
              </p>
              <p className="mt-1 text-lg font-semibold text-white">
                {m.landingPrivateOfficePrice()}
              </p>
              <p className="mt-4 text-silver/90">
                {m.landingPrivateOfficeText()}
              </p>
            </div>
            <Card className="border-silver/25 bg-white/5 text-silver shadow-none">
              <CardHeader>
                <CardTitle className="text-white">
                  {m.landingUiTeamPerksTitle()}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-silver/90">
                  {privateOfficePerks.map((perk) => (
                    <li key={perk} className="rounded-lg bg-white/10 px-3 py-2">
                      {perk}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 rounded-lg border border-sunset-yellow/45 bg-sunset-yellow/15 px-3 py-3 text-sm text-silver">
                  <p className="font-semibold text-white">
                    {m.landingMeetingRoomTitle()}
                  </p>
                  <p className="mt-1">{m.landingMeetingRoomText()}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="about" className="py-16 sm:py-20">
          <h2 className="text-3xl sm:text-4xl">{m.landingUniversumTitle()}</h2>
          <p className="mt-4 max-w-3xl text-lg text-burned-orange">
            {m.landingUniversumLead()}
          </p>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {universumParagraphs.map((paragraph) => (
              <Card key={paragraph}>
                <CardContent className="pt-6">
                  <p className="text-sm leading-relaxed text-navy-blue/85">
                    {paragraph}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>
      </main>

      <footer id="kontakt" className="mt-8 bg-navy-blue py-14 text-silver">
        <Container>
          <h2 className="text-3xl text-white">{m.landingFaqTitle()}</h2>
          <div className="mt-6 grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div className="space-y-3">
              {faqItems.map((item) => (
                <Card
                  key={item.question}
                  className="border-silver/20 bg-white/5 text-silver"
                >
                  <CardHeader>
                    <CardTitle className="text-base text-white">
                      {item.question}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-silver/90">{item.answer}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="border-sunset-yellow/35 bg-white text-navy-blue">
              <CardHeader>
                <CardTitle>{m.landingFooterContactTitle()}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{m.landingFooterContactLead()}</p>
                <p>
                  {workspaceSiteConstants.contact.address.street},{" "}
                  {workspaceSiteConstants.contact.address.cityDistrict},{" "}
                  {workspaceSiteConstants.contact.address.city}{" "}
                  {workspaceSiteConstants.contact.address.postalCode}
                </p>
                <p>{workspaceSiteConstants.contact.phone}</p>
                <p>{workspaceSiteConstants.contact.infoEmail}</p>
                <div className="flex flex-wrap gap-3 pt-2">
                  <Button asChild>
                    <a
                      href={`mailto:${workspaceSiteConstants.contact.infoEmail}`}
                    >
                      {m.landingFooterContactCta()}
                    </a>
                  </Button>
                  <Button asChild variant="secondary">
                    <a href='/bar'>{m.landingFooterBarCta()}</a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="my-8 h-px bg-silver/20" />
          <p className="text-xs uppercase tracking-[0.12em] text-silver/70">
            {m.landingFooterLegal()}
          </p>
        </Container>
      </footer>
    </>
  );
}
