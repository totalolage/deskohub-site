import { Clock3, DoorOpen, type LucideIcon, MapPin } from "lucide-react";
import Link from "next/link";
import type { WorkspaceLocale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { getPricingContent } from "@/features/pricing";
import { Container } from "@/shared/components/container";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { cn, type workspaceSiteConstants } from "@/shared/utils";

type ContactAddress = typeof workspaceSiteConstants.contact.address;

type LandingPagePricingContactSectionProps = {
  locale: WorkspaceLocale;
  pricingSectionId: string;
  faqContactSectionId: string;
  contactHref: string;
  deskohubBarCtaHref: string;
  contactAddress: ContactAddress;
  contactEmail: string;
};

type PricingCard = {
  name: string;
  price: string;
  text: string;
  comingSoon: boolean;
  featured: boolean;
  contactHref?: string;
};

export function LandingPagePricingContactSection({
  locale,
  pricingSectionId,
  faqContactSectionId,
  contactHref,
  deskohubBarCtaHref,
  contactAddress,
  contactEmail,
}: LandingPagePricingContactSectionProps) {
  const pricingContent = getPricingContent(locale);
  const pricingCards: PricingCard[] = [
    ...pricingContent.tariffs.map((tariff) => ({
      name: tariff.name,
      price: tariff.price,
      text: tariff.description,
      comingSoon: tariff.comingSoon,
      featured: tariff.featured,
    })),
    {
      name: pricingContent.eventPricing.name,
      price: pricingContent.eventPricing.price,
      text: pricingContent.eventPricing.description,
      comingSoon: false,
      featured: false,
      contactHref,
    },
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

  return (
    <>
      <section
        id={pricingSectionId}
        className="border-t border-navy-blue/8 bg-[radial-gradient(circle_at_top_right,rgba(0,223,153,0.1),transparent_24%),linear-gradient(180deg,#e6ddd0_0%,#f8f4ec_5.5rem,#fbfaf6_100%)] py-20 sm:py-24"
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
                    "relative rounded-[1.9rem] border border-navy-blue/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(249,246,239,0.98)_100%)] shadow-[0_26px_70px_-48px_rgba(0,2,79,0.24)]",
                    item.comingSoon &&
                      "border border-dashed border-burned-orange/24 bg-[linear-gradient(180deg,#fff8ee_0%,#ffffff_100%)]",
                    item.featured &&
                      "border-burned-orange/18 bg-[linear-gradient(180deg,#fff9f4_0%,#ffffff_100%)] shadow-[0_34px_90px_-50px_rgba(221,72,10,0.65)]"
                  )}
                >
                  <CardHeader>
                    {item.comingSoon ? (
                      <Badge
                        variant="emphasis"
                        className="absolute right-4 top-0 mb-4 w-fit -translate-y-1/2"
                      >
                        {m.landingCoworkComingSoonBadge({}, { locale })}
                      </Badge>
                    ) : null}
                    {item.featured ? (
                      <Badge
                        variant="emphasis"
                        className="absolute right-4 top-0 mb-4 w-fit -translate-y-1/2"
                      >
                        {m.landingPricingFeaturedBadge({}, { locale })}
                      </Badge>
                    ) : null}
                    <CardTitle>{item.name}</CardTitle>
                    <CardDescription className="text-2xl text-burned-orange">
                      {item.price}
                    </CardDescription>
                    {item.comingSoon ? (
                      <p className="text-sm leading-7 text-navy-blue/72">
                        {m.landingPricingComingSoonNote({}, { locale })}
                      </p>
                    ) : null}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-5">
                      <p className="text-sm leading-7 text-navy-blue/78">
                        {item.text}
                      </p>
                      {item.contactHref ? (
                        <Button
                          asChild
                          variant="secondary"
                          className="h-11 border-navy-blue/10 bg-[#f4f1ea] px-5 text-sm uppercase tracking-[0.08em] text-navy-blue hover:bg-sunset-yellow"
                        >
                          <Link href={item.contactHref}>
                            {m.landingFooterContactCta({}, { locale })}
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <section
        id={faqContactSectionId}
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
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    asChild
                    className="h-12 px-7 text-sm uppercase tracking-[0.08em]"
                  >
                    <Link href={contactHref}>
                      {m.landingFooterContactCta({}, { locale })}
                    </Link>
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
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

type ContactRowProps = {
  icon: LucideIcon;
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
