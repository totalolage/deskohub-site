import {
  CalendarRange,
  Clock3,
  DoorOpen,
  MapPin,
  Monitor,
  Sparkles,
  Users,
} from "lucide-react";
import Image from "next/image";
import type React from "react";
import type { WorkspaceLocale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { HorizontalLogo, Logo } from "@/shared/components/logo";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { cn, workspaceSiteConstants } from "@/shared/utils";
import heroImage from "../images/hero.jpeg";
import onboarding1 from "../images/onboarding-1.png";
import onboarding2 from "../images/onboarding-2.png";
import onboarding3 from "../images/onboarding-3.png";
import onboarding4 from "../images/onboarding-4.png";
import { LandingPageHeader } from "./landing-page-header";

type LandingPageProps = {
  locale: WorkspaceLocale;
};

export function LandingPage({ locale }: LandingPageProps) {
  const localePath = `/${locale}`;
  const sectionIds = {
    overview: "overview",
    ttrpg: "ttrpg",
    events: "events",
    cowork: "cowork",
    pricing: "pricing",
    privateOffice: "private-office",
    faqContact: "faq-contact",
  } as const;

  const languageLabels: Record<WorkspaceLocale, string> = {
    "cs-CZ": m.languageCzech({}, { locale }),
    "en-US": m.languageEnglish({}, { locale }),
  };

  const headerLinks = [
    {
      label: m.landingNavOverview({}, { locale }),
      href: `#${sectionIds.overview}`,
    },
    { label: m.landingNavTtrpg({}, { locale }), href: `#${sectionIds.ttrpg}` },
    {
      label: m.landingNavEvents({}, { locale }),
      href: `#${sectionIds.events}`,
    },
    {
      label: m.landingNavCowork({}, { locale }),
      href: `#${sectionIds.cowork}`,
    },
    {
      label: m.landingNavPricing({}, { locale }),
      href: `#${sectionIds.pricing}`,
    },
    {
      label: m.landingNavPrivateOffice({}, { locale }),
      href: `#${sectionIds.privateOffice}`,
    },
    {
      label: m.landingNavFaqContact({}, { locale }),
      href: `#${sectionIds.faqContact}`,
    },
  ];

  const heroHighlights = [
    {
      icon: DoorOpen,
      label: m.landingHeroHighlightOne({}, { locale }),
    },
    {
      icon: Sparkles,
      label: m.landingHeroHighlightTwo({}, { locale }),
    },
    {
      icon: MapPin,
      label: m.landingHeroHighlightThree({}, { locale }),
    },
  ];

  const overviewCards = [
    {
      title: m.landingRozcestnikBarTitle({}, { locale }),
      text: m.landingRozcestnikBarText({}, { locale }),
      className: "border-burned-orange/20 bg-white text-navy-blue",
    },
    {
      title: m.landingRozcestnikWorkspaceTitle({}, { locale }),
      text: m.landingRozcestnikWorkspaceText({}, { locale }),
      className: "border-white/10 bg-navy-blue text-white",
    },
  ];

  const ttrpgFeatures = [
    {
      label: m.landingTtrpgFeatureOneLabel({}, { locale }),
      text: m.landingTtrpgFeatureOneText({}, { locale }),
    },
    {
      label: m.landingTtrpgFeatureTwoLabel({}, { locale }),
      text: m.landingTtrpgFeatureTwoText({}, { locale }),
    },
    {
      label: m.landingTtrpgFeatureThreeLabel({}, { locale }),
      text: m.landingTtrpgFeatureThreeText({}, { locale }),
    },
  ];

  const eventFeatures = [
    m.landingEventsFeatureOne({}, { locale }),
    m.landingEventsFeatureTwo({}, { locale }),
    m.landingEventsFeatureThree({}, { locale }),
  ];

  const pricingCards = [
    {
      name: m.landingPricingItemOneName({}, { locale }),
      price: m.landingPricingItemOnePrice({}, { locale }),
      text: m.landingPricingItemOneText({}, { locale }),
      featured: false,
    },
    {
      name: m.landingPricingItemTwoName({}, { locale }),
      price: m.landingPricingItemTwoPrice({}, { locale }),
      text: m.landingPricingItemTwoText({}, { locale }),
      featured: true,
    },
    {
      name: m.landingPricingItemThreeName({}, { locale }),
      price: m.landingPricingItemThreePrice({}, { locale }),
      text: m.landingPricingItemThreeText({}, { locale }),
      featured: false,
    },
    {
      name: m.landingPricingItemFourName({}, { locale }),
      price: m.landingPricingItemFourPrice({}, { locale }),
      text: m.landingPricingItemFourText({}, { locale }),
      featured: false,
    },
  ];

  const coworkCards = [
    {
      icon: Users,
      title: m.landingCoworkOfficeTitle({}, { locale }),
      text: m.landingCoworkOfficeText({}, { locale }),
    },
    {
      icon: Monitor,
      title: m.landingCoworkWorkstationTitle({}, { locale }),
      text: m.landingCoworkWorkstationText({}, { locale }),
    },
  ];

  const privateOfficePerks = [
    m.landingPrivateOfficePerkOne({}, { locale }),
    m.landingPrivateOfficePerkTwo({}, { locale }),
    m.landingPrivateOfficePerkThree({}, { locale }),
  ];

  const faqItems = [
    {
      question: m.landingFaqItemOneQuestion({}, { locale }),
      answer: m.landingFaqItemOneAnswer({}, { locale }),
    },
    {
      question: m.landingFaqItemTwoQuestion({}, { locale }),
      answer: m.landingFaqItemTwoAnswer({}, { locale }),
    },
    {
      question: m.landingFaqItemThreeQuestion({}, { locale }),
      answer: m.landingFaqItemThreeAnswer({}, { locale }),
    },
  ];

  const onboardingSteps = [
    {
      src: onboarding1,
      alt: "Booking flow preview",
      scale: 1.2,
      panelClassName: "min-h-40 mb-12",
      imageClassName: "p-4",
    },
    {
      src: onboarding2,
      alt: "Access code preview",
      scale: 1,
      panelClassName: "min-h-44 mb-2",
      imageClassName: "p-3",
    },
    {
      src: onboarding3,
      alt: "Entry screen preview",
      scale: 1.5,
      panelClassName: "min-h-44 sm:mt-10",
      imageClassName: "p-3",
    },
  ] as const;

  const localizedHash = (hash: string) => `${localePath}${hash}`;
  const deskohubBarCtaHref = localizedHash(`#${sectionIds.overview}`);
  const contactAddress = workspaceSiteConstants.contact.address;
  const contactEmail = workspaceSiteConstants.contact.infoEmail;

  return (
    <>
      <LandingPageHeader
        currentLocale={locale}
        languageLabels={languageLabels}
        links={headerLinks}
        contactLabel={m.landingNavContactLabel({}, { locale })}
      />

      <main className="overflow-x-clip bg-[#f4f1ea] text-navy-blue">
        <section
          id={sectionIds.overview}
          className="relative isolate min-h-screen overflow-hidden bg-navy-blue pt-24 text-white"
        >
          <Image
            src={heroImage}
            alt="Deskohub workspace interior"
            fill
            priority
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,2,79,0.94)_0%,rgba(0,2,79,0.8)_38%,rgba(0,2,79,0.56)_64%,rgba(0,2,79,0.74)_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(255,255,255,0.08),transparent_22%),radial-gradient(circle_at_88%_20%,rgba(236,164,35,0.34),transparent_18%),radial-gradient(circle_at_64%_80%,rgba(221,72,10,0.22),transparent_22%)]" />
          <div className="absolute right-0 top-28 h-56 w-56 translate-x-1/4 rotate-45 rounded-[2.75rem] border border-white/10 bg-burned-orange/50 shadow-[0_20px_80px_-20px_rgba(221,72,10,0.95)]" />
          <div className="absolute right-28 top-30 h-20 w-20 rotate-45 rounded-[1.25rem] border border-white/12 bg-burned-orange/50" />
          <div className="absolute left-[-4.5rem] top-[55%] h-30 w-40 -translate-y-1/2 text-sunset-yellow/60">
            <HeroHexagon />
          </div>
          <div className="absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(180deg,transparent_0%,rgb(245,124,0)_100%)]" />

          <Container className="relative z-10 flex min-h-[calc(100vh-6rem)] items-center py-10 lg:py-16">
            <div className="grid w-full gap-12 lg:grid-cols-[minmax(0,1.02fr)_minmax(360px,0.98fr)] lg:items-center">
              <div className="max-w-3xl">
                <h1 className="max-w-4xl text-5xl leading-[0.95] text-balance sm:text-6xl lg:text-7xl">
                  {m.landingHeroTitle({}, { locale })}
                </h1>
                <p className="mt-6 max-w-xl text-lg leading-8 text-white/82 sm:text-xl">
                  {m.landingHeroSubtitle({}, { locale })}
                </p>

                <div className="mt-9 flex flex-col gap-4 sm:flex-row">
                  <Button
                    asChild
                    className="h-14 bg-burned-orange px-8 text-base uppercase tracking-[0.08em] hover:bg-burned-orange/90"
                  >
                    <a href={localizedHash(`#${sectionIds.pricing}`)}>
                      {m.landingHeroPrimaryCta({}, { locale })}
                    </a>
                  </Button>
                  <Button
                    asChild
                    variant="secondary"
                    className="h-14 border-white/16 bg-white/92 px-8 text-base uppercase tracking-[0.08em] text-navy-blue hover:bg-white"
                  >
                    <a href={localizedHash(`#${sectionIds.events}`)}>
                      {m.landingHeroSecondaryCta({}, { locale })}
                    </a>
                  </Button>
                </div>

                <div className="mt-10 grid gap-3 sm:grid-cols-3">
                  {heroHighlights.map((highlight) => (
                    <div
                      key={highlight.label}
                      className="rounded-[1.6rem] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-md"
                    >
                      <highlight.icon className="h-5 w-5 text-sunset-yellow" />
                      <p className="mt-3 text-sm leading-6 text-white/84">
                        {highlight.label}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative mx-auto w-full max-w-[38rem] lg:mr-0">
                <div className="grid gap-4 sm:grid-cols-3">
                  {onboardingSteps.map((step) => (
                    <div
                      key={step.alt}
                      className={cn("relative", step.panelClassName)}
                    >
                      <Image
                        src={step.src}
                        alt={step.alt}
                        fill
                        className={cn(
                          "object-contain object-center drop-shadow-[0_26px_48px_rgba(0,0,0,0.35)]",
                          step.imageClassName
                        )}
                        style={{ transform: `scale(${step.scale})` }}
                      />
                    </div>
                  ))}

                  <div className="relative sm:col-span-3">
                    <Image src={onboarding4} alt="Workspace session preview" />
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </section>

        <section className="relative overflow-hidden bg-[#f57c00] py-16 sm:py-20 lg:py-24">
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute -left-10 top-1/2 h-36 w-40 -translate-y-1/2 text-navy-blue/30">
              <HeroHexagon />
            </div>
            <div className="absolute bottom-12 left-16 h-14 w-14 rotate-45 rounded-2xl bg-navy-blue" />
            <div className="absolute bottom-24 left-32 h-9 w-9 rotate-45 rounded-xl bg-navy-blue" />
            <div className="absolute right-24 top-12 h-18 w-18 rotate-45 rounded-[1.6rem] bg-[#da6b00]" />
            <div className="absolute bottom-8 right-0 h-32 w-64">
              <div className="absolute bottom-5 right-8 h-1 w-48 rotate-[-30deg] bg-navy-blue" />
              <div className="absolute bottom-14 right-16 h-1 w-32 rotate-[-30deg] bg-navy-blue" />
            </div>
          </div>

          <Container className="relative z-10">
            <div className="text-center">
              <h2 className="text-3xl text-navy-blue sm:text-4xl">
                {m.landingUniversumTitle({}, { locale })}
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-lg leading-8 text-navy-blue/78">
                {m.landingUniversumLead({}, { locale })}
              </p>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              {overviewCards.map((card) => (
                <Card
                  key={card.title}
                  className={cn("rounded-[1.75rem]", card.className)}
                >
                  <CardHeader>
                    <CardTitle
                      className={
                        card.className.includes("text-white")
                          ? "text-white"
                          : undefined
                      }
                    >
                      {card.title}
                    </CardTitle>
                    <CardDescription
                      className={
                        card.className.includes("text-white")
                          ? "text-white/72"
                          : "text-navy-blue/76"
                      }
                    >
                      {card.text}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </Container>
        </section>

        <section id={sectionIds.ttrpg} className="bg-[#f4f1ea] py-20 sm:py-24">
          <Container>
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
              <div>
                <Badge>{m.landingTtrpgSectionLabel({}, { locale })}</Badge>
                <h2 className="mt-4 text-4xl leading-tight text-balance sm:text-5xl">
                  {m.landingTtrpgTitle({}, { locale })}
                </h2>
                <p className="mt-5 max-w-xl text-lg leading-8 text-navy-blue/76">
                  {m.landingTtrpgText({}, { locale })}
                </p>
                <div className="mt-6 rounded-[1.75rem] border border-burned-orange/16 bg-white px-6 py-5 shadow-[0_24px_60px_-42px_rgba(0,2,79,0.48)]">
                  <p className="text-sm leading-7 text-navy-blue/82">
                    {m.landingTtrpgDetail({}, { locale })}
                  </p>
                </div>
                <Button
                  asChild
                  className="mt-7 h-12 px-7 text-sm uppercase tracking-[0.08em]"
                >
                  <a href={localizedHash(`#${sectionIds.faqContact}`)}>
                    {m.landingTtrpgCta({}, { locale })}
                  </a>
                </Button>
              </div>

              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {ttrpgFeatures.map((feature, index) => (
                  <Card
                    key={feature.label}
                    className={cn(
                      "rounded-[1.75rem] border-white/20 shadow-[0_28px_70px_-44px_rgba(0,2,79,0.55)]",
                      index === 1
                        ? "bg-navy-blue text-white md:translate-y-10"
                        : "bg-white"
                    )}
                  >
                    <CardHeader>
                      <CardTitle
                        className={index === 1 ? "text-white" : undefined}
                      >
                        {feature.label}
                      </CardTitle>
                      <CardDescription
                        className={index === 1 ? "text-white/72" : undefined}
                      >
                        {feature.text}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          </Container>
        </section>

        <section id={sectionIds.events} className="bg-white py-20 sm:py-24">
          <Container>
            <div className="grid gap-8 lg:grid-cols-[1.02fr_0.98fr]">
              <Card className="rounded-[2rem] border-burned-orange/16 bg-[linear-gradient(160deg,#fff4e8_0%,#ffffff_50%,#f3f2ef_100%)] shadow-[0_32px_80px_-54px_rgba(0,2,79,0.4)]">
                <CardHeader>
                  <Badge>{m.landingEventsSectionLabel({}, { locale })}</Badge>
                  <CardTitle className="text-4xl sm:text-5xl">
                    {m.landingEventsTitle({}, { locale })}
                  </CardTitle>
                  <CardDescription className="max-w-2xl text-base leading-8 text-navy-blue/76">
                    {m.landingEventsText({}, { locale })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {eventFeatures.map((feature) => (
                    <div
                      key={feature}
                      className="rounded-[1.5rem] border border-white/80 bg-white/92 px-5 py-4 text-sm leading-7 text-navy-blue/82 shadow-[0_14px_40px_-34px_rgba(0,2,79,0.5)]"
                    >
                      {feature}
                    </div>
                  ))}
                  <Button
                    asChild
                    className="mt-3 h-12 px-7 text-sm uppercase tracking-[0.08em]"
                  >
                    <a href={localizedHash(`#${sectionIds.faqContact}`)}>
                      {m.landingEventsCta({}, { locale })}
                    </a>
                  </Button>
                </CardContent>
              </Card>

              <div className="grid gap-5">
                <Card className="rounded-[2rem] border-burned-orange/20 bg-burned-orange text-white shadow-[0_34px_80px_-45px_rgba(221,72,10,0.8)]">
                  <CardHeader>
                    <div className="flex items-center gap-3 text-white/84">
                      <CalendarRange className="h-5 w-5" />
                      <p className="text-xs uppercase tracking-[0.24em]">
                        {m.landingUiEventsCateringTitle({}, { locale })}
                      </p>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-7 text-white/88">
                      {m.landingEventsFoodCallout({}, { locale })}
                    </p>
                  </CardContent>
                </Card>

                <Card className="rounded-[2rem] border-white/10 bg-navy-blue text-white shadow-[0_34px_80px_-45px_rgba(0,2,79,0.76)]">
                  <CardHeader>
                    <CardTitle className="text-white">
                      {m.landingEventsFullSpaceRentalTitle({}, { locale })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-7 text-white/74">
                      {m.landingEventsFullSpaceRentalDetail({}, { locale })}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </Container>
        </section>

        <section
          id={sectionIds.cowork}
          className="bg-navy-blue py-20 text-white sm:py-24"
        >
          <Container>
            <div className="grid gap-8 lg:grid-cols-[1.04fr_0.96fr] lg:items-start">
              <div>
                <Badge className="border-white/12 bg-white/8 text-white">
                  {m.landingCoworkSectionLabel({}, { locale })}
                </Badge>
                <h2 className="mt-4 text-4xl leading-tight text-balance sm:text-5xl">
                  {m.landingCoworkTitle({}, { locale })}
                </h2>
                <div className="mt-8 grid gap-4 md:grid-cols-2">
                  {coworkCards.map((card, index) => (
                    <Card
                      key={card.title}
                      className={cn(
                        "rounded-[1.75rem] border-white/10 bg-white/6 text-white shadow-none backdrop-blur-md",
                        index === 1 && "bg-white text-navy-blue"
                      )}
                    >
                      <CardHeader>
                        <div
                          className={cn(
                            "flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10",
                            index === 1 && "bg-navy-blue text-white"
                          )}
                        >
                          <card.icon className="h-6 w-6" />
                        </div>
                        <CardTitle
                          className={index === 1 ? undefined : "text-white"}
                        >
                          {card.title}
                        </CardTitle>
                        <CardDescription
                          className={
                            index === 1 ? "text-navy-blue/76" : "text-white/72"
                          }
                        >
                          {card.text}
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              </div>

              <Card
                id={sectionIds.privateOffice}
                className="rounded-[2rem] border-burned-orange/16 bg-[#f4f1ea] shadow-[0_34px_90px_-55px_rgba(0,0,0,0.85)]"
              >
                <CardHeader>
                  <Badge>
                    {m.landingPrivateOfficeSectionLabel({}, { locale })}
                  </Badge>
                  <CardTitle className="text-4xl leading-tight sm:text-[2.8rem]">
                    {m.landingPrivateOfficeTitle({}, { locale })}
                  </CardTitle>
                  <CardDescription className="text-base leading-8 text-navy-blue/76">
                    {m.landingPrivateOfficeText({}, { locale })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="rounded-[1.6rem] border border-burned-orange/16 bg-white px-5 py-5">
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-burned-orange/78">
                          {m.landingPrivateOfficeName({}, { locale })}
                        </p>
                        <p className="mt-2 text-3xl text-navy-blue">
                          {m.landingPrivateOfficePrice({}, { locale })}
                        </p>
                      </div>
                      <Logo
                        styling={{ color: "light", variant: "plain" }}
                        height={56}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {privateOfficePerks.map((perk) => (
                      <div
                        key={perk}
                        className="rounded-[1.35rem] border border-navy-blue/10 bg-white px-4 py-4 text-sm leading-6 text-navy-blue/82"
                      >
                        {perk}
                      </div>
                    ))}
                  </div>

                  <div className="rounded-[1.6rem] bg-navy-blue px-5 py-5 text-white">
                    <p className="text-xs uppercase tracking-[0.22em] text-sunset-yellow/82">
                      {m.landingMeetingRoomTitle({}, { locale })}
                    </p>
                    <p className="mt-3 text-sm leading-7 text-white/76">
                      {m.landingMeetingRoomText({}, { locale })}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </Container>
        </section>

        <section
          id={sectionIds.pricing}
          className="bg-[#f4f1ea] py-20 sm:py-24"
        >
          <Container>
            <div className="grid gap-8 lg:grid-cols-[0.88fr_1.12fr] lg:items-start">
              <div className="space-y-5">
                <Badge>{m.landingPricingTitle({}, { locale })}</Badge>
                <h2 className="text-4xl leading-tight text-balance sm:text-5xl">
                  {m.landingPricingSubtitle({}, { locale })}
                </h2>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                {pricingCards.map((item) => (
                  <Card
                    key={item.name}
                    className={cn(
                      "relative rounded-[1.9rem] bg-white shadow-[0_26px_70px_-48px_rgba(0,2,79,0.45)]",
                      item.featured &&
                        "border-burned-orange/18 bg-[linear-gradient(180deg,#fff9f4_0%,#ffffff_100%)] shadow-[0_34px_90px_-50px_rgba(221,72,10,0.65)]"
                    )}
                  >
                    <CardHeader>
                      {item.featured ? (
                        <Badge variant="emphasis" className="mb-4 w-fit absolute top-0 right-4 -translate-y-1/2">
                          {m.landingPricingFeaturedBadge({}, { locale })}
                        </Badge>
                      ) : null}
                      <CardTitle>{item.name}</CardTitle>
                      <CardDescription className="text-2xl text-burned-orange">
                        {item.price}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-7 text-navy-blue/78">
                        {item.text}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </Container>
        </section>

        <section
          id={sectionIds.faqContact}
          className="bg-white pb-20 pt-20 sm:pb-24 sm:pt-24"
        >
          <Container>
            <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
              <Card className="rounded-[2rem] border-white/10 bg-navy-blue text-white shadow-[0_34px_90px_-55px_rgba(0,2,79,0.9)]">
                <CardHeader>
                  <Badge className="border-white/12 bg-white/8 text-white">
                    {m.landingFaqTitle({}, { locale })}
                  </Badge>
                  <CardTitle className="text-4xl leading-tight text-white sm:text-[2.8rem]">
                    {m.landingFooterContactTitle({}, { locale })}
                  </CardTitle>
                  <CardDescription className="text-base leading-8 text-white/74">
                    {m.landingFooterContactLead({}, { locale })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-3">
                    <ContactRow
                      icon={MapPin}
                      title={m.landingFaqItemTwoQuestion({}, { locale })}
                      body={`${contactAddress.street}, ${contactAddress.cityDistrict}, ${contactAddress.city} ${contactAddress.postalCode}`}
                    />
                    <ContactRow
                      icon={DoorOpen}
                      title={m.landingFaqItemOneQuestion({}, { locale })}
                      body={m.landingFaqItemOneAnswer({}, { locale })}
                    />
                    <ContactRow
                      icon={Clock3}
                      title={m.landingFaqItemThreeQuestion({}, { locale })}
                      body={m.landingFaqItemThreeAnswer({}, { locale })}
                    />
                  </div>

                  <div className="rounded-[1.6rem] border border-white/10 bg-white/6 p-5 text-sm leading-7 text-white/78">
                    <p>
                      <a
                        href={`mailto:${contactEmail}`}
                        className="text-sunset-yellow transition-colors hover:text-white"
                      >
                        {contactEmail}
                      </a>
                    </p>
                    <p>
                      <a
                        href={`tel:${workspaceSiteConstants.contact.phone}`}
                        className="text-sunset-yellow transition-colors hover:text-white"
                      >
                        {workspaceSiteConstants.contact.phone}
                      </a>
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button
                      asChild
                      className="h-12 px-7 text-sm uppercase tracking-[0.08em]"
                    >
                      <a href={`mailto:${contactEmail}`}>
                        {m.landingFooterContactCta({}, { locale })}
                      </a>
                    </Button>
                    <Button
                      asChild
                      variant="secondary"
                      className="h-12 border-white/12 bg-white text-sm uppercase tracking-[0.08em] text-navy-blue hover:bg-sunset-yellow"
                    >
                      <a href={deskohubBarCtaHref}>
                        {m.landingFooterBarCta({}, { locale })}
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-5">
                {faqItems.map((item) => (
                  <Card
                    key={item.question}
                    className="rounded-[1.8rem] bg-[#f4f1ea] shadow-[0_24px_60px_-46px_rgba(0,2,79,0.45)]"
                  >
                    <CardHeader>
                      <CardTitle className="text-2xl sm:text-[1.85rem]">
                        {item.question}
                      </CardTitle>
                      <CardDescription className="text-base leading-8 text-navy-blue/76">
                        {item.answer}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                ))}

                <Card className="rounded-[1.8rem] bg-white shadow-[0_24px_60px_-46px_rgba(0,2,79,0.35)]">
                  <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                    <HorizontalLogo
                      styling={{ color: "light", variant: "color" }}
                      className="justify-start px-0 py-0"
                    />
                    <p className="text-sm text-navy-blue/62">
                      {m.landingFooterLegal({}, { locale })}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </Container>
        </section>
      </main>
    </>
  );
}

function HeroHexagon() {
  return (
    <svg
      viewBox="0 0 100 115.4701"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      className="h-full w-full"
      aria-hidden="true"
    >
      <path d="M50 0 L100 28.8675 L100 86.6025 L50 115.4701 L0 86.6025 L0 28.8675 Z" />
    </svg>
  );
}

type ContactRowProps = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
};

function ContactRow({ icon: Icon, title, body }: ContactRowProps) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/8 text-sunset-yellow">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-sm leading-6 text-white/70">{body}</p>
        </div>
      </div>
    </div>
  );
}
