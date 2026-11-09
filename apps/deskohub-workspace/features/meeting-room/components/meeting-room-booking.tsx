import Interpolate from "@doist/react-interpolate";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { type Locale, m } from "@/features/i18n";
import { getMeetingRoomReservationPath } from "@/features/reservation/routes";
import { Button } from "@/shared/components/ui/button";
import { textLink } from "@/shared/components/ui/text-link";

/** The page's closing call to book, with the price list and the TTRPG use. */
export function MeetingRoomBooking({ locale }: { locale: Locale }) {
  const localePath = `/${locale}`;

  return (
    <section
      aria-labelledby="meeting-room-booking-heading"
      className="border-t border-white/10"
    >
      <div className="mx-auto grid w-full max-w-8xl gap-10 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-16 lg:px-8 xl:px-14">
        <div className="max-w-[44rem]">
          <h2
            className="text-[clamp(3.125rem,5.4vw,5.75rem)] leading-[0.96] tracking-[-0.06em]"
            id="meeting-room-booking-heading"
          >
            {m.meetingRoomBookingTitle({}, { locale })}
          </h2>
          <p className="mt-8 text-lg leading-[1.65] text-silver/82">
            <Interpolate
              string={m.meetingRoomBookingText({}, { locale })}
              mapping={{
                pricing: (content) => (
                  <Link
                    href={`${localePath}/pricing`}
                    className={textLink({ tone: "inverse" })}
                  >
                    {content}
                  </Link>
                ),
              }}
            />
          </p>
          <p className="mt-4 leading-[1.65] text-silver/76">
            <Interpolate
              string={m.meetingRoomTtrpgNote({}, { locale })}
              mapping={{
                ttrpg: (content) => (
                  <Link
                    href={`${localePath}/ttrpg-room`}
                    className={textLink({ tone: "inverse" })}
                  >
                    {content}
                  </Link>
                ),
              }}
            />
          </p>
        </div>
        <Button
          asChild
          tone="chilean-fire"
          size="2xl"
          shape="rounded"
          caps
          className="group sm:min-w-[17rem]"
        >
          <Link href={getMeetingRoomReservationPath(locale)}>
            {m.meetingRoomReservationCta({}, { locale })}
            <ArrowUpRight
              aria-hidden="true"
              className="ml-auto size-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </Link>
        </Button>
      </div>
    </section>
  );
}
