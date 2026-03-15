import darkBgColor from "assets/logo/color-bg:dark.svg";
import lightBgColor from "assets/logo/color-bg:light.svg";
import darkBgFancy from "assets/logo/fancy-bg:dark.svg";
import lightBgFancy from "assets/logo/fancy-bg:light.svg";
import type { WorkspaceLocale } from "@/features/i18n";
import { getLandingCopy } from "@/features/landing-page/content";
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

type LandingPageProps = {
  locale: WorkspaceLocale;
};

export function LandingPage({ locale }: LandingPageProps) {
  const copy = getLandingCopy(locale);
  const localePath = `/${locale}`;
  const navLinks = copy.nav.links.map((item) => ({
    label: item.label,
    href: `${localePath}${item.href}`,
  }));
  const localizedHash = (hash: string) => `${localePath}${hash}`;

  return (
    <>
      <SiteHeader
        locale={locale}
        languageSwitcherPath={localePath}
        links={navLinks}
        contactLabel={copy.nav.contactLabel}
      />

      <main className="overflow-hidden">
        <Section className="relative pt-10 sm:pt-14">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_10%_18%,rgba(0,223,153,0.18),transparent_36%),radial-gradient(circle_at_84%_12%,rgba(221,72,10,0.16),transparent_32%),linear-gradient(180deg,#f5f6f9_0%,#ffffff_40%)]" />
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
              <Badge>{copy.hero.kicker}</Badge>
              <h1 className="mt-5 max-w-4xl text-4xl leading-tight sm:text-5xl lg:text-6xl">
                {copy.hero.title}
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-navy-blue/85">
                {copy.hero.subtitle}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild>
                  <a href={localizedHash("#cenik")}>{copy.hero.primaryCta}</a>
                </Button>
                <Button asChild variant="secondary">
                  <a href={localizedHash("#eventy")}>
                    {copy.hero.secondaryCta}
                  </a>
                </Button>
              </div>
              <ul className="mt-8 grid gap-2 sm:grid-cols-3">
                {copy.hero.highlights.map((highlight) => (
                  <li
                    key={highlight}
                    className="rounded-xl border border-navy-blue/15 bg-white/80 px-3 py-2 text-sm text-navy-blue/85"
                  >
                    {highlight}
                  </li>
                ))}
              </ul>
            </div>

            <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000">
              <div className="grid gap-4 sm:grid-cols-2">
                <Card className="overflow-hidden border-navy-blue/20 bg-navy-blue text-silver sm:col-span-2">
                  <CardContent className="grid gap-4 p-4 sm:grid-cols-[0.72fr_1fr] sm:items-center sm:p-5">
                    <ImageWithFallback
                      src={lightBgFancy}
                      fallbackSrc={lightBgColor}
                      alt={copy.ui.heroPrimaryImageAlt}
                      className="h-36 w-full rounded-xl bg-white/5 object-contain p-3"
                    />
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-sunset-yellow">
                        {copy.ui.heroVisualTag}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-silver/90">
                        {copy.rozcestnik.microcopy}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="overflow-hidden border-burned-orange/25 bg-[linear-gradient(150deg,#fff5eb,#ffffff)]">
                  <CardContent className="p-4">
                    <ImageWithFallback
                      src={darkBgFancy}
                      fallbackSrc={darkBgColor}
                      alt={copy.ui.heroSecondaryImageAlt}
                      className="h-36 w-full rounded-xl bg-white object-contain p-3"
                    />
                  </CardContent>
                </Card>
                <Card className="border-aquamarine-green/30 bg-[linear-gradient(145deg,#f0fff8,#ffffff)]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      {copy.ui.heroStatsTitle}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm text-navy-blue/85">
                      {copy.hero.stats.map((stat) => (
                        <li
                          key={stat.label}
                          className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2"
                        >
                          <span>{stat.label}</span>
                          <span className="font-semibold text-burned-orange">
                            {stat.value}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </Section>

        <Section id="rozcestnik" className="py-16 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <h2 className="text-3xl sm:text-4xl">{copy.rozcestnik.title}</h2>
              <p className="mt-4 max-w-2xl text-navy-blue/80">
                {copy.rozcestnik.description}
              </p>
            </div>
            <p className="rounded-2xl border border-navy-blue/10 bg-white/80 p-5 text-sm leading-relaxed text-navy-blue/80">
              {copy.rozcestnik.microcopy}
            </p>
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <Card className="bg-[linear-gradient(150deg,#fff4e8,#ffffff)]">
              <CardHeader>
                <CardTitle>{copy.rozcestnik.bar.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-navy-blue/85">{copy.rozcestnik.bar.text}</p>
              </CardContent>
            </Card>
            <Card className="border-aquamarine-green/35 bg-[linear-gradient(145deg,#ecfff8,#ffffff)]">
              <CardHeader>
                <CardTitle>{copy.rozcestnik.workspace.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-navy-blue/85">
                  {copy.rozcestnik.workspace.text}
                </p>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="ttrpg" className="bg-navy-blue py-16 text-silver sm:py-20">
          <div className="grid gap-7 lg:grid-cols-[1.08fr_0.92fr]">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-sunset-yellow">
                {copy.ttrpg.sectionLabel}
              </p>
              <h2 className="mt-3 text-3xl text-white sm:text-4xl">
                {copy.ttrpg.title}
              </h2>
              <p className="mt-4 text-silver/90">{copy.ttrpg.text}</p>
              <p className="mt-4 rounded-xl border border-silver/20 bg-white/5 px-4 py-3 text-sm text-silver/90">
                {copy.ttrpg.detail}
              </p>
              <Button
                asChild
                className="mt-6 bg-white text-navy-blue hover:bg-white/90"
              >
                <a href={localizedHash("#kontakt")}>{copy.ttrpg.cta}</a>
              </Button>
            </div>
            <div className="grid gap-3">
              {copy.ttrpg.features.map((feature) => (
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
                {copy.eventsWorkshops.sectionLabel}
              </p>
              <h2 className="mt-3 text-3xl sm:text-4xl">
                {copy.eventsWorkshops.title}
              </h2>
              <p className="mt-4 text-navy-blue/85">
                {copy.eventsWorkshops.text}
              </p>
              <ul className="mt-5 space-y-2 text-sm text-navy-blue/85">
                {copy.eventsWorkshops.features.map((item) => (
                  <li
                    key={item}
                    className="rounded-xl border border-navy-blue/10 bg-white px-4 py-3"
                  >
                    {item}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6">
                <a href={localizedHash("#kontakt")}>
                  {copy.eventsWorkshops.cta}
                </a>
              </Button>
            </div>
            <div className="grid gap-4">
              <Card className="border-burned-orange/25 bg-[linear-gradient(145deg,#fff7f0,#ffffff)]">
                <CardHeader>
                  <CardTitle>{copy.ui.eventsCateringTitle}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-navy-blue/85">
                    {copy.eventsWorkshops.foodCallout}
                  </p>
                </CardContent>
              </Card>
              <Card className="border-navy-blue/20 bg-navy-blue text-silver">
                <CardHeader>
                  <CardTitle className="text-white">
                    {copy.eventsWorkshops.fullSpaceRental.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-silver/90">
                    {copy.eventsWorkshops.fullSpaceRental.detail}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </Section>

        <Section id="cowork" className="bg-silver/18 py-16 sm:py-20">
          <p className="text-xs uppercase tracking-[0.16em] text-burned-orange">
            {copy.coworkWorkstation.sectionLabel}
          </p>
          <h2 className="mt-3 text-3xl sm:text-4xl">
            {copy.coworkWorkstation.title}
          </h2>
          <div className="mt-7 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{copy.coworkWorkstation.officeTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-navy-blue/85">
                  {copy.coworkWorkstation.officeText}
                </p>
              </CardContent>
            </Card>
            <Card className="border-aquamarine-green/25 bg-[linear-gradient(145deg,#f2fff9,#ffffff)]">
              <CardHeader>
                <CardTitle>{copy.coworkWorkstation.workstationTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-navy-blue/85">
                  {copy.coworkWorkstation.workstationText}
                </p>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="cenik" className="py-16 sm:py-20">
          <h2 className="text-3xl sm:text-4xl">{copy.pricing.title}</h2>
          <p className="mt-4 max-w-3xl text-navy-blue/80">
            {copy.pricing.subtitle}
          </p>
          <div className="mt-8 grid gap-4 lg:grid-cols-4">
            {copy.pricing.items.map((item) => (
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
                        {copy.pricing.featuredBadge}
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
                {copy.privateOfficeMeetingRoom.sectionLabel}
              </p>
              <h2 className="mt-3 text-3xl text-white sm:text-4xl">
                {copy.privateOfficeMeetingRoom.title}
              </h2>
              <p className="mt-4 text-xl text-sunset-yellow">
                {copy.privateOfficeMeetingRoom.name}
              </p>
              <p className="mt-1 text-lg font-semibold text-white">
                {copy.privateOfficeMeetingRoom.price}
              </p>
              <p className="mt-4 text-silver/90">
                {copy.privateOfficeMeetingRoom.text}
              </p>
            </div>
            <Card className="border-silver/25 bg-white/5 text-silver shadow-none">
              <CardHeader>
                <CardTitle className="text-white">
                  {copy.ui.teamPerksTitle}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-silver/90">
                  {copy.privateOfficeMeetingRoom.perks.map((perk) => (
                    <li key={perk} className="rounded-lg bg-white/10 px-3 py-2">
                      {perk}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 rounded-lg border border-sunset-yellow/45 bg-sunset-yellow/15 px-3 py-3 text-sm text-silver">
                  <p className="font-semibold text-white">
                    {copy.privateOfficeMeetingRoom.meetingRoom.title}
                  </p>
                  <p className="mt-1">
                    {copy.privateOfficeMeetingRoom.meetingRoom.text}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="about" className="py-16 sm:py-20">
          <h2 className="text-3xl sm:text-4xl">{copy.universum.title}</h2>
          <p className="mt-4 max-w-3xl text-lg text-burned-orange">
            {copy.universum.lead}
          </p>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {copy.universum.paragraphs.map((paragraph) => (
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
          <h2 className="text-3xl text-white">{copy.faqContactFooter.title}</h2>
          <div className="mt-6 grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div className="space-y-3">
              {copy.faqContactFooter.items.map((item) => (
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
                <CardTitle>{copy.faqContactFooter.contactTitle}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{copy.faqContactFooter.contactLead}</p>
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
                      {copy.faqContactFooter.contactCta}
                    </a>
                  </Button>
                  <Button asChild variant="secondary">
                    <a href={`${localePath}/bar`}>
                      {copy.faqContactFooter.barCta}
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="my-8 h-px bg-silver/20" />
          <p className="text-xs uppercase tracking-[0.12em] text-silver/70">
            {copy.faqContactFooter.legal}
          </p>
        </Container>
      </footer>
    </>
  );
}
