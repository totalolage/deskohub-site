import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { generateBlurDataUrlCached } from "@/features/gallery/actions/generate-blur-data-url";
import { getCloudinaryImageByPublicId } from "@/features/gallery/actions/get-cloudinary-image-by-public-id";
import { m, setLocale } from "@/features/i18n";
import { LocalizedLink } from "@/features/i18n/components/localized-link";
import { Button } from "@/shared/components/ui/button";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../../../route";
import { isPalmovconPageExpired } from "./page-availability";

const reservationHref = "/reservation";
const facebookEventHref = "https://www.facebook.com/share/1D39ZcqBkS/";
const heroPublicId = "palmovcon-2026-hero";

const getSchedule = () => [
  {
    title: m["palmovcon2026.schedule.miniaturePainting.title"](),
    time: m["palmovcon2026.schedule.miniaturePainting.time"](),
    description: m["palmovcon2026.schedule.miniaturePainting.description"](),
  },
  {
    title: m["palmovcon2026.schedule.witcher.title"](),
    time: m["palmovcon2026.schedule.witcher.time"](),
    description: m["palmovcon2026.schedule.witcher.description"](),
    note: m["palmovcon2026.schedule.witcher.note"](),
  },
  {
    title: m["palmovcon2026.schedule.bloodOnTheClocktower.title"](),
    time: m["palmovcon2026.schedule.bloodOnTheClocktower.time"](),
    description: m["palmovcon2026.schedule.bloodOnTheClocktower.description"](),
    note: m["palmovcon2026.schedule.bloodOnTheClocktower.note"](),
  },
  {
    title: m["palmovcon2026.schedule.bazaar.title"](),
    time: m["palmovcon2026.schedule.bazaar.time"](),
    description: m["palmovcon2026.schedule.bazaar.description"](),
  },
];

export const generateMetadata = metadata({
  title: m["palmovcon2026.pageTitle"](),
  description: m["palmovcon2026.pageDescription"](),
});

export default async function Palmovcon2026Page({ params }: RouteProps_locale) {
  const { locale } = await params;
  setLocale(locale, { reload: false });

  await connection();
  if (isPalmovconPageExpired()) {
    notFound();
  }

  const schedule = getSchedule();
  const heroImage = await getCloudinaryImageByPublicId(heroPublicId);
  const heroBlurDataURL = heroImage
    ? await generateBlurDataUrlCached(heroImage).catch(() => undefined)
    : undefined;

  return (
    <main className="min-h-screen overflow-hidden bg-[#060852] text-[#FFFFFE]">
      <section className="relative pb-16 lg:pb-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(109,170,156,0.26),_transparent_34%),radial-gradient(circle_at_80%_10%,_rgba(137,158,40,0.22),_transparent_30%),linear-gradient(135deg,_rgba(6,8,82,0.96),_rgba(35,34,30,0.93))]" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#060852] to-transparent" />

        <h1 className="sr-only">{m["palmovcon2026.title"]()}</h1>
        {heroImage ? (
          <div className="relative h-[500px] overflow-hidden bg-[linear-gradient(90deg,_#060852_0_50%,_#23221E_50%_100%)]">
            <CloudinaryImage
              alt={m["palmovcon2026.heroAlt"]()}
              asset={heroImage}
              blurDataURL={heroBlurDataURL}
              className="mx-auto h-full w-auto max-w-none"
              priority
              sizes="100vw"
              variant="full"
            />
          </div>
        ) : (
          <div className="relative flex h-[500px] items-center bg-[linear-gradient(90deg,_#060852_0_50%,_#23221E_50%_100%)] px-4 sm:px-6 lg:px-8">
            <h1 className="max-w-4xl font-black text-5xl tracking-tight sm:text-7xl lg:text-8xl">
              {m["palmovcon2026.title"]()}
            </h1>
          </div>
        )}

        <div className="relative mx-auto mt-12 grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-8">
          <div>
            <p className="inline-flex rounded-full border border-[#6DAA9C]/50 bg-[#6DAA9C]/15 px-4 py-2 font-semibold text-[#FFFFFE] text-sm uppercase tracking-[0.28em]">
              {m["palmovcon2026.date"]()}
            </p>
            <p className="mt-5 max-w-2xl text-2xl text-[#FFFFFE]/90">
              {m["palmovcon2026.subtitle"]()}
            </p>
            <p className="mt-8 max-w-2xl text-lg text-[#FFFFFE]/80 leading-8">
              {m["palmovcon2026.intro"]()}
            </p>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Button
                asChild
                className="h-14 rounded-full bg-[#899E28] px-8 font-black text-[#060852] text-base hover:bg-[#6DAA9C]"
                size="lg"
              >
                <LocalizedLink href={reservationHref}>
                  {m["palmovcon2026.reservationCta"]()}
                </LocalizedLink>
              </Button>
              <span className="text-[#FFFFFE]/70 text-sm">
                {m["palmovcon2026.location"]()}
              </span>
            </div>
          </div>

          <aside className="rounded-[2rem] border border-[#6DAA9C]/25 bg-[#FFFFFE] p-6 text-[#060852] shadow-2xl shadow-[#060852]/50">
            <h2 className="font-black text-2xl text-[#23221E]">
              {m["palmovcon2026.quickSummaryTitle"]()}
            </h2>
            <dl className="mt-6 grid gap-5">
              <div>
                <dt className="font-semibold text-[#060852]/70 text-sm uppercase tracking-[0.2em]">
                  {m["palmovcon2026.dateLabel"]()}
                </dt>
                <dd className="mt-1 text-2xl text-[#060852]">
                  {m["palmovcon2026.date"]()}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-[#060852]/70 text-sm uppercase tracking-[0.2em]">
                  {m["palmovcon2026.locationLabel"]()}
                </dt>
                <dd className="mt-1 text-2xl text-[#060852]">
                  {m["palmovcon2026.venue"]()}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-[#060852]/70 text-sm uppercase tracking-[0.2em]">
                  {m["palmovcon2026.entryFeeLabel"]()}
                </dt>
                <dd className="mt-1 text-2xl text-[#060852]">
                  {m["palmovcon2026.entryFeeShort"]()}
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-3 lg:px-8">
        <div className="rounded-3xl border border-[#6DAA9C]/20 bg-[#FFFFFE] p-6 text-[#060852] lg:col-span-1">
          <p className="font-semibold text-[#060852]/70 text-sm uppercase tracking-[0.22em]">
            {m["palmovcon2026.practicalInfoEyebrow"]()}
          </p>
          <h2 className="mt-3 font-black text-3xl text-[#23221E]">
            {m["palmovcon2026.practicalInfoTitle"]()}
          </h2>
        </div>
        <div className="grid gap-4 lg:col-span-2 sm:grid-cols-2">
          <article className="rounded-3xl bg-[#FFFFFE] p-6 text-[#060852]">
            <h3 className="font-black text-[#23221E] text-xl">
              {m["palmovcon2026.entryFeeTitle"]()}
            </h3>
            <p className="mt-3 text-[#060852]/75">
              {m["palmovcon2026.entryFeeDescription"]()}
            </p>
          </article>
          <article className="rounded-3xl bg-[#FFFFFE] p-6 text-[#060852]">
            <h3 className="font-black text-[#23221E] text-xl">
              {m["palmovcon2026.complexGamesTitle"]()}
            </h3>
            <p className="mt-3 text-[#060852]/80">
              {m["palmovcon2026.complexGamesDescription"]()}
            </p>
          </article>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-semibold text-[#899E28] text-sm uppercase tracking-[0.22em]">
              {m["palmovcon2026.scheduleEyebrow"]()}
            </p>
            <h2 className="mt-3 font-black text-4xl">
              {m["palmovcon2026.scheduleTitle"]()}
            </h2>
          </div>
          <p className="max-w-xl text-[#FFFFFE]/65">
            {m["palmovcon2026.scheduleDescription"]()}
          </p>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {schedule.map((item) => (
            <article
              className="rounded-[1.75rem] border border-[#6DAA9C]/20 bg-[#FFFFFE] p-6 text-[#060852] shadow-xl shadow-[#060852]/25"
              key={item.title}
            >
              <p className="font-bold text-[#060852]/80">{item.time}</p>
              <h3 className="mt-3 font-black text-2xl text-[#23221E]">
                {item.title}
              </h3>
              <p className="mt-4 text-[#060852]/75 leading-7">
                {item.description}
              </p>
              {item.note ? (
                <p className="mt-5 rounded-2xl bg-[#899E28]/20 px-4 py-3 font-semibold text-[#060852]">
                  {item.note}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl rounded-[2rem] bg-[#899E28] p-8 text-[#060852] shadow-2xl shadow-[#060852]/30 lg:p-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="font-semibold text-sm uppercase tracking-[0.22em] text-[#060852]/70">
                {m["palmovcon2026.footerEyebrow"]()}
              </p>
              <h2 className="mt-3 font-black text-3xl">
                {m["palmovcon2026.footerTitle"]()}
              </h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                className="h-12 rounded-full bg-[#060852] px-6 font-bold text-[#FFFFFE] hover:bg-[#23221E]"
              >
                <a href={facebookEventHref} rel="noreferrer" target="_blank">
                  {m["palmovcon2026.facebookCta"]()}
                </a>
              </Button>
              <Button
                asChild
                className="h-12 rounded-full border-[#060852] px-6 font-bold text-[#060852] hover:bg-[#060852]/10"
                variant="outline"
              >
                <LocalizedLink href={reservationHref}>
                  {m["palmovcon2026.secondaryReservationCta"]()}
                </LocalizedLink>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
