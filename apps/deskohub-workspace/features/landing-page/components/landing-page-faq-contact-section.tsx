import { Clock3, DoorOpen, type LucideIcon, MapPin } from "lucide-react";
import Link from "next/link";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
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
import type { workspaceSiteConstants } from "@/shared/utils";

type ContactAddress = typeof workspaceSiteConstants.contact.address;

type LandingPageFaqContactSectionProps = {
  locale: Locale;
  faqContactSectionId: string;
  contactHref: string;
  deskohubBarCtaHref: string;
  contactAddress: ContactAddress;
  contactEmail: string;
};

export function LandingPageFaqContactSection({
  locale,
  faqContactSectionId,
  contactHref,
  deskohubBarCtaHref,
  contactAddress,
  contactEmail,
}: LandingPageFaqContactSectionProps) {
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
    <section
      id={faqContactSectionId}
      className="bg-[linear-gradient(180deg,#05083f_0%,#0d1258_45%,#15123e_100%)] pb-20 pt-20 sm:pb-24 sm:pt-24"
    >
      <Container>
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
          <Card className="rounded-4xl border-white/10 bg-navy-blue text-white shadow-[0_34px_90px_-55px_rgba(0,2,79,0.9)]">
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
  );
}

type ContactRowProps = {
  icon: LucideIcon;
  title: string;
  body: string;
};

function ContactRow({ icon: Icon, title, body }: ContactRowProps) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
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
