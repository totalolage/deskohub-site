import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import { type Locale, m } from "@/features/i18n";
import { getMeetingRoomReservationPath } from "@/features/reservation/routes";
import { Button } from "@/shared/components/ui/button";

type MeetingRoomHeroProps = {
  image?: CloudinaryAsset;
  locale: Locale;
};

export function MeetingRoomHero({ image, locale }: MeetingRoomHeroProps) {
  return (
    <section
      aria-labelledby="meeting-room-heading"
      className="relative min-h-[100dvh] overflow-hidden bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:3.25rem_3.25rem] pt-(--site-header-height)"
    >
      <span
        aria-hidden="true"
        className="absolute left-[3%] top-[calc(var(--site-header-height)+1rem)] font-mono text-[0.625rem] tracking-[0.14em] text-white/32"
      >
        A / 01
      </span>
      <span
        aria-hidden="true"
        className="absolute bottom-[4%] right-[3%] hidden font-mono text-[0.625rem] tracking-[0.14em] text-white/32 lg:block"
      >
        B / 10
      </span>

      <div className="mx-auto grid min-h-[calc(100dvh-var(--site-header-height))] w-full max-w-8xl items-center gap-14 px-4 py-18 sm:px-6 sm:py-22 lg:grid-cols-[minmax(0,1.02fr)_minmax(26rem,0.98fr)] lg:gap-[clamp(3rem,5vw,5.625rem)] lg:px-8 lg:py-16 xl:px-14">
        <div className="relative z-10">
          <p className="mb-7 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.13em] text-sunset-yellow">
            {m.meetingRoomHeroEyebrow({}, { locale })}
          </p>
          <h1
            className="max-w-5xl text-[clamp(3.4rem,7.25vw,7.875rem)] leading-[0.89] tracking-[-0.065em] text-balance"
            id="meeting-room-heading"
          >
            {m.meetingRoomHeroTitle({}, { locale })}
            <br />
            <span className="text-burned-orange">
              {m.meetingRoomHeroTitleAccent({}, { locale })}
            </span>
          </h1>
          <p className="mt-8 max-w-[38rem] text-lg leading-[1.65] text-silver/82 sm:text-xl">
            {m.meetingRoomHeroIntro({}, { locale })}
          </p>

          <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <Button
              asChild
              className="group h-16 justify-between rounded-2xl bg-chilean-fire px-7 text-xs text-navy-blue uppercase tracking-[0.09em] hover:bg-chilean-fire/90 sm:min-w-[17rem]"
            >
              <Link href={getMeetingRoomReservationPath(locale)}>
                {m.meetingRoomReservationCta({}, { locale })}
                <ArrowUpRight
                  aria-hidden="true"
                  className="size-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                />
              </Link>
            </Button>
            <a
              className="inline-flex h-14 items-center justify-center gap-3 px-4 text-xs font-semibold uppercase tracking-[0.09em] text-white/82 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burned-orange"
              href="#meeting-room-gallery"
            >
              {m.meetingRoomGalleryCta({}, { locale })}
              <ArrowDown
                aria-hidden="true"
                className="size-4 text-burned-orange"
              />
            </a>
          </div>

          <ul
            aria-label={m.meetingRoomFactsLabel({}, { locale })}
            className="mt-10 flex flex-col items-start gap-2 font-mono text-[0.625rem] uppercase tracking-[0.08em] text-silver/76 sm:flex-row sm:gap-0"
          >
            <li className="sm:pr-4">
              {m.meetingRoomFactCapacity({}, { locale })}
            </li>
            <li className="sm:border-l sm:border-white/22 sm:px-4">
              {m.meetingRoomFactTv({}, { locale })}
            </li>
            <li className="sm:border-l sm:border-white/22 sm:pl-4">
              {m.meetingRoomFactPrivacy({}, { locale })}
            </li>
          </ul>
        </div>

        <div className="relative mx-auto flex w-full max-w-[43rem] items-center justify-center py-10 lg:py-0">
          <div
            aria-hidden="true"
            className="absolute aspect-square w-[min(88vw,47.5rem)]"
          >
            <span className="absolute inset-0 rounded-full border border-burned-orange/46 after:absolute after:right-[11%] after:top-[13%] after:size-3 after:rounded-full after:bg-burned-orange after:shadow-[0_0_0_6px_rgba(221,72,10,0.14)]" />
            <span className="absolute inset-[10%] rounded-full border border-burned-orange/46" />
            <span className="absolute inset-[20%] rounded-full border border-white/17" />
          </div>

          <figure className="relative z-10 m-0 w-full before:absolute before:-inset-3 before:-z-10 before:rounded-t-[16rem] before:rounded-b-[2.125rem] before:border before:border-burned-orange/82 max-sm:before:-inset-2">
            <div className="relative aspect-[9/10] overflow-hidden rounded-t-[15.625rem] rounded-b-[1.625rem] border border-white/25 bg-white/6">
              {image ? (
                <CloudinaryImage
                  alt={m.meetingRoomHeroImageAlt({}, { locale })}
                  className="absolute inset-0 size-full object-cover brightness-[0.74] contrast-[1.08] saturate-[0.76]"
                  preload
                  sizes="(min-width: 1024px) 46vw, (min-width: 640px) 75vw, 92vw"
                  size={{ width: "fill", height: "fill" }}
                  source={image}
                  variant="gallery"
                />
              ) : (
                <div className="grid size-full place-items-center px-8 text-center text-sm text-silver/68">
                  {m.meetingRoomPhotosComingSoon({}, { locale })}
                </div>
              )}
            </div>
            <figcaption className="absolute inset-x-5 bottom-5 flex items-center justify-between rounded-[1.125rem] border border-white/22 bg-navy-blue/82 px-5 py-4 backdrop-blur-md">
              <span className="font-mono text-[0.625rem] uppercase tracking-[0.1em] text-silver/72">
                {m.meetingRoomHeroModeLabel({}, { locale })}
              </span>
              <strong className="text-xs uppercase tracking-[0.1em] text-sunset-yellow">
                {m.meetingRoomHeroModeValue({}, { locale })}
              </strong>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
