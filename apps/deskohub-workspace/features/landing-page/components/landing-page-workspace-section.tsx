import { type LucideIcon, Monitor, Users } from "lucide-react";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { Logo } from "@/shared/components/logo";
import { Badge } from "@/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { cn } from "@/shared/utils";

type LandingPageWorkspaceSectionProps = {
  locale: Locale;
  coworkSectionId: string;
  privateOfficeSectionId: string;
  contactEmail: string;
};

export function LandingPageWorkspaceSection({
  locale,
  coworkSectionId,
  privateOfficeSectionId,
  contactEmail,
}: LandingPageWorkspaceSectionProps) {
  const coworkCards: Array<{ icon: LucideIcon; title: string; text: string }> =
    [
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

  return (
    <section
      id={coworkSectionId}
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
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/74 sm:text-base">
              {m.landingCoworkComingSoonText({}, { locale })}
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {coworkCards.map((card, index) => (
                <Card
                  key={card.title}
                  className={cn(
                    "relative rounded-[1.75rem] border-white/10 bg-white/6 text-white shadow-none backdrop-blur-md",
                    index === 1 &&
                      "border border-dashed border-sunset-yellow/30 bg-[linear-gradient(180deg,rgba(236,164,35,0.12)_0%,rgba(255,255,255,0.98)_100%)]",
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
                    <CardTitle className={cn(index !== 1 && "text-white")}>
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
            id={privateOfficeSectionId}
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
                <div className="mt-3 space-y-3 text-sm leading-7 text-white/76">
                  <p>{m.landingMeetingRoomText({}, { locale })}</p>
                  <p>
                    {m.landingMeetingRoomReservationFallbackBefore(
                      {},
                      { locale }
                    )}
                    <a
                      href={`mailto:${contactEmail}`}
                      className="text-sunset-yellow transition-colors hover:text-white"
                    >
                      {contactEmail}
                    </a>
                    {m.landingMeetingRoomReservationFallbackAfter(
                      {},
                      { locale }
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </Container>
    </section>
  );
}
