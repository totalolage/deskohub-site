import Interpolate from "@doist/react-interpolate";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-page-feature-flag";
import { isOfficePageEnabled } from "@/features/office/backend/office-reservation-feature-flag.server";
import {
  getCoworkReservationPath,
  getMeetingRoomReservationPath,
} from "@/features/reservation/routes";
import { Container } from "@/shared/components/container";
import { Button } from "@/shared/components/ui/button";
import { textLink } from "@/shared/components/ui/text-link";

/**
 * What a visitor can book, each with its booking or detail link. Events and
 * private offices are mentioned but never offered as bookable.
 */
export async function LandingPageOfferingSection({
  locale,
}: {
  locale: Locale;
}) {
  const [meetingRoomPageEnabled, officePageEnabled] = await Promise.all([
    isMeetingRoomPageEnabled(),
    isOfficePageEnabled(),
  ]);
  const localePath = `/${locale}`;

  return (
    <section
      aria-labelledby="landing-offering-heading"
      className="bg-[#f4f1ea] text-navy-blue"
    >
      <Container className="grid gap-12 py-20 sm:py-28 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-20">
        <div>
          <h2
            id="landing-offering-heading"
            className="text-4xl leading-tight text-balance sm:text-5xl"
          >
            {m.landingOfferingTitle({}, { locale })}
          </h2>
          <p className="mt-6 max-w-md text-lg leading-8 text-navy-blue/74">
            <Interpolate
              string={m.landingOfferingLead({}, { locale })}
              mapping={{
                pricing: (content) => (
                  <Link href={`${localePath}/pricing`} className={textLink()}>
                    {content}
                  </Link>
                ),
              }}
            />
          </p>
        </div>

        <div>
          <ul className="border-t border-navy-blue/18">
            <OfferingRow title={m.landingOfferingCoworkTitle({}, { locale })}>
              <p>
                <strong className="font-semibold text-navy-blue">
                  {getWorkspaceProductTierTitle("open-space", locale)}:
                </strong>{" "}
                {m.landingOfferingOpenSpaceText({}, { locale })}
              </p>
              <p>
                <strong className="font-semibold text-navy-blue">
                  {getWorkspaceProductTierTitle("reserved-desk", locale)}:
                </strong>{" "}
                {m.landingOfferingReservedDeskText({}, { locale })}
              </p>
              <OfferingActions>
                <Button asChild size="lg" caps>
                  <Link href={getCoworkReservationPath(locale)}>
                    {m.coworkReservationLink({}, { locale })}
                  </Link>
                </Button>
                <Link href={`${localePath}/coworking`} className={textLink()}>
                  {m.landingOfferingCoworkPageLink({}, { locale })}
                </Link>
              </OfferingActions>
            </OfferingRow>

            <OfferingRow title={getWorkspaceMeetingRoomProductTitle(locale)}>
              <p>{m.landingOfferingMeetingRoomText({}, { locale })}</p>
              <OfferingActions>
                <Button asChild size="lg" caps>
                  <Link href={getMeetingRoomReservationPath(locale)}>
                    {m.meetingRoomReservationLink({}, { locale })}
                  </Link>
                </Button>
                {meetingRoomPageEnabled && (
                  <Link
                    href={`${localePath}/meeting-room`}
                    className={textLink()}
                  >
                    {m.landingOfferingMeetingRoomPageLink({}, { locale })}
                  </Link>
                )}
              </OfferingActions>
            </OfferingRow>

            <OfferingRow title={m.landingOfferingTtrpgTitle({}, { locale })}>
              <p>{m.landingOfferingTtrpgText({}, { locale })}</p>
              <OfferingActions>
                <Link href={`${localePath}/ttrpg-room`} className={textLink()}>
                  {m.landingOfferingTtrpgLink({}, { locale })}
                </Link>
              </OfferingActions>
            </OfferingRow>
          </ul>

          <p className="mt-8 max-w-2xl leading-7 text-navy-blue/74">
            <Interpolate
              string={m.landingOfferingEvents({}, { locale })}
              mapping={{
                contact: (content) => (
                  <Link href={`${localePath}/contact`} className={textLink()}>
                    {content}
                  </Link>
                ),
              }}
            />
            {!officePageEnabled && (
              <> {m.landingOfferingOffices({}, { locale })}</>
            )}
          </p>
        </div>
      </Container>
    </section>
  );
}

function OfferingRow({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="grid gap-4 border-b border-navy-blue/18 py-8 sm:grid-cols-[minmax(9rem,0.6fr)_minmax(0,1.4fr)] sm:gap-8">
      <h3 className="text-2xl leading-tight tracking-[-0.02em] sm:text-3xl">
        {title}
      </h3>
      <div className="space-y-3 leading-7 text-navy-blue/74">{children}</div>
    </li>
  );
}

function OfferingActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4 pt-3">
      {children}
    </div>
  );
}
