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
import { workspaceSiteConstants } from "@/shared/utils";

type LandingPageContactSectionProps = {
  locale: Locale;
  contactHref: string;
  deskohubBarCtaHref: string;
};

export function LandingPageContactSection({
  locale,
  contactHref,
  deskohubBarCtaHref,
}: LandingPageContactSectionProps) {
  const contactEmail = workspaceSiteConstants.contact.infoEmail;

  return (
    <section className="bg-[linear-gradient(180deg,#05083f_0%,#0d1258_45%,#15123e_100%)] pb-20 pt-20 sm:pb-24 sm:pt-24">
      <Container className="max-w-3xl">
        <Card className="rounded-4xl border-white/10 bg-navy-blue text-white shadow-[0_34px_90px_-55px_rgba(0,2,79,0.9)]">
          <CardHeader>
            <Badge className="border-white/12 bg-white/8 text-white">
              {m.landingNavContactLabel({}, { locale })}
            </Badge>
            <CardTitle
              as="h2"
              className="text-4xl leading-tight text-white sm:text-[2.8rem]"
            >
              {m.landingFooterContactTitle({}, { locale })}
            </CardTitle>
            <CardDescription className="text-base leading-8 text-white/74">
              {m.landingFooterContactLead({}, { locale })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
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
      </Container>
    </section>
  );
}
