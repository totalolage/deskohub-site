import { Clock3, DoorOpen, type LucideIcon, MapPin } from "lucide-react";
import type { WorkspaceLocale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { HorizontalLogo } from "@/shared/components/logo";
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
  deskohubBarCtaHref: string;
  contactAddress: ContactAddress;
  contactEmail: string;
  contactPhone: string;
};

export function LandingPagePricingContactSection({
  locale,
  pricingSectionId,
  faqContactSectionId,
  deskohubBarCtaHref,
  contactAddress,
  contactEmail,
  contactPhone,
}: LandingPagePricingContactSectionProps) {
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
      <section id={pricingSectionId} className="bg-[#f4f1ea] py-20 sm:py-24">
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
                  <p>
                    <a
                      href={`tel:${contactPhone}`}
                      className="text-sunset-yellow transition-colors hover:text-white"
                    >
                      {contactPhone}
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
