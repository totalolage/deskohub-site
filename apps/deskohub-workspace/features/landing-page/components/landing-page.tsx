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
import { Separator } from "@/shared/components/ui/separator";
import { workspaceSiteConstants } from "@/shared/utils";

type LandingPageProps = {
  locale: WorkspaceLocale;
};

export function LandingPage({ locale }: LandingPageProps) {
  const copy = getLandingCopy(locale);
  const localePath = `/${locale}`;
  const navLinks = copy.nav.map((item) => ({
    label: item.label,
    href: `${localePath}${item.href}`,
  }));

  return (
    <>
      <SiteHeader
        locale={locale}
        languageSwitcherPath={localePath}
        links={navLinks}
        contactLabel={copy.faq.contactCta}
      />

      <main>
        <Section className="relative overflow-hidden pt-10 sm:pt-14">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_12%_20%,rgba(0,223,153,0.12),transparent_40%),radial-gradient(circle_at_86%_8%,rgba(221,72,10,0.18),transparent_38%)]" />
          <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
            <div className="animate-in fade-in slide-in-from-bottom-6 duration-700">
              <Badge>{copy.hero.kicker}</Badge>
              <h1 className="mt-4 max-w-4xl text-4xl leading-tight sm:text-5xl">
                {copy.hero.title}
              </h1>
              <p className="mt-4 max-w-2xl text-lg text-navy-blue/85">
                {copy.hero.subtitle}
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild>
                  <a href={`${localePath}#cenik`}>{copy.hero.primaryCta}</a>
                </Button>
                <Button asChild variant="secondary">
                  <a href={`${localePath}#eventy`}>{copy.hero.secondaryCta}</a>
                </Button>
              </div>
            </div>

            <Card className="animate-in fade-in slide-in-from-bottom-8 duration-1000 bg-navy-blue text-silver">
              <CardHeader>
                <CardTitle className="text-white">
                  {copy.labels.heroPanelTitle}
                </CardTitle>
                <CardDescription className="text-silver/85">
                  {copy.labels.heroPanelDescription}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm">
                  {copy.hero.highlights.map((highlight) => (
                    <li
                      key={highlight}
                      className="rounded-xl border border-silver/25 bg-white/5 px-3 py-2"
                    >
                      {highlight}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="rozcestnik">
          <h2 className="text-3xl">{copy.split.title}</h2>
          <p className="mt-3 max-w-3xl text-navy-blue/80">
            {copy.split.description}
          </p>
          <div className="mt-7 grid gap-4 md:grid-cols-2">
            <Card className="bg-[linear-gradient(145deg,#fff6ed,#ffffff)]">
              <CardHeader>
                <CardTitle>{copy.split.bar.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-navy-blue/85">{copy.split.bar.text}</p>
              </CardContent>
            </Card>
            <Card className="border-aquamarine-green/40 bg-[linear-gradient(145deg,#ecfff8,#ffffff)]">
              <CardHeader>
                <CardTitle>{copy.split.workspace.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-navy-blue/85">{copy.split.workspace.text}</p>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="ttrpg" className="bg-silver/20">
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-start">
            <div>
              <h2 className="text-3xl">TTRPG & DnD Room</h2>
              <h3 className="mt-2 text-2xl text-burned-orange">
                {copy.ttrpg.title}
              </h3>
              <p className="mt-3 text-navy-blue/85">{copy.ttrpg.text}</p>
              <Button asChild className="mt-6">
                <a href={`${localePath}#kontakt`}>{copy.ttrpg.cta}</a>
              </Button>
            </div>
            <div className="grid gap-3">
              {copy.ttrpg.features.map((feature) => (
                <Card key={feature.label}>
                  <CardHeader>
                    <CardTitle className="text-lg">{feature.label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-navy-blue/85">{feature.text}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </Section>

        <Section id="eventy">
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div>
              <h2 className="text-3xl">{copy.events.title}</h2>
              <p className="mt-3 text-navy-blue/85">{copy.events.text}</p>
              <ul className="mt-5 space-y-2 text-sm text-navy-blue/85">
                {copy.events.features.map((item) => (
                  <li
                    key={item}
                    className="rounded-lg border border-navy-blue/10 bg-white px-3 py-2"
                  >
                    {item}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6">
                <a href={`${localePath}#kontakt`}>{copy.events.cta}</a>
              </Button>
            </div>
            <Card className="border-burned-orange/30 bg-[linear-gradient(145deg,#fff9f5,#ffffff)]">
              <CardHeader>
                <CardTitle>{copy.labels.eventsPanelTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-navy-blue/85">{copy.events.foodCallout}</p>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="cowork" className="bg-silver/20">
          <h2 className="text-3xl">{copy.cowork.title}</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{copy.cowork.officeTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-navy-blue/85">
                  {copy.cowork.officeText}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{copy.cowork.workstationTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-navy-blue/85">
                  {copy.cowork.workstationText}
                </p>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="cenik">
          <h2 className="text-3xl">{copy.pricing.title}</h2>
          <p className="mt-3 max-w-3xl text-navy-blue/80">
            {copy.pricing.subtitle}
          </p>
          <div className="mt-7 grid gap-4 lg:grid-cols-4">
            {copy.pricing.items.map((item) => (
              <Card
                key={item.name}
                className={
                  item.featured
                    ? "border-burned-orange/40 shadow-[0_24px_56px_-28px_rgba(221,72,10,0.55)]"
                    : undefined
                }
              >
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-lg">{item.name}</CardTitle>
                    {item.featured ? (
                      <Badge variant="emphasis">
                        {copy.labels.featuredBadge}
                      </Badge>
                    ) : null}
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

        <Section id="office" className="bg-silver/20">
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-start">
            <div>
              <h2 className="text-3xl">{copy.privateOffice.title}</h2>
              <p className="mt-4 text-xl text-burned-orange">
                {copy.privateOffice.name}
              </p>
              <p className="mt-1 text-lg font-semibold">
                {copy.privateOffice.price}
              </p>
              <p className="mt-3 text-navy-blue/85">
                {copy.privateOffice.text}
              </p>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>{copy.labels.teamPerksTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-navy-blue/85">
                  {copy.privateOffice.perks.map((perk) => (
                    <li
                      key={perk}
                      className="rounded-lg bg-silver/30 px-3 py-2"
                    >
                      {perk}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 rounded-lg border border-aquamarine-green/40 bg-aquamarine-green/10 px-3 py-2 text-sm text-navy-blue">
                  {copy.privateOffice.meetingRoomNote}
                </p>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section id="about">
          <h2 className="text-3xl">{copy.about.title}</h2>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {copy.about.paragraphs.map((paragraph) => (
              <Card key={paragraph}>
                <CardContent className="pt-6">
                  <p className="text-sm text-navy-blue/85">{paragraph}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>
      </main>

      <footer id="kontakt" className="mt-8 bg-navy-blue py-14 text-silver">
        <Container>
          <h2 className="text-3xl text-white">{copy.faq.title}</h2>
          <div className="mt-6 grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div className="space-y-3">
              {copy.faq.items.map((item) => (
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
                <CardTitle>{copy.faq.contactTitle}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
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
                      {copy.faq.contactCta}
                    </a>
                  </Button>
                  <Button asChild variant="secondary">
                    <a href="/bar">{copy.labels.barButton}</a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
          <Separator className="my-8 bg-silver/20" />
          <p className="text-xs uppercase tracking-[0.12em] text-silver/70">
            {copy.faq.legal}
          </p>
        </Container>
      </footer>
    </>
  );
}
