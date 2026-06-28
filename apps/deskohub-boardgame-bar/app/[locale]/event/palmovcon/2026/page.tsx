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

const reservationHref = "/reservation?message=Palmovcon";
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
    <main className="min-h-screen overflow-hidden bg-[#140b20] text-amber-50">
      <section className="relative pb-16 lg:pb-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.35),_transparent_34%),radial-gradient(circle_at_80%_10%,_rgba(217,70,239,0.28),_transparent_30%),linear-gradient(135deg,_rgba(20,11,32,0.95),_rgba(48,16,72,0.92))]" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#140b20] to-transparent" />

        <h1 className="sr-only">{m["palmovcon2026.title"]()}</h1>
        {heroImage ? (
          <div className="relative h-[500px] overflow-hidden bg-[linear-gradient(90deg,_#060950_0_50%,_#242321_50%_100%)]">
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
          <div className="relative flex h-[500px] items-center bg-[linear-gradient(90deg,_#060950_0_50%,_#242321_50%_100%)] px-4 sm:px-6 lg:px-8">
            <h1 className="max-w-4xl font-black text-5xl tracking-tight sm:text-7xl lg:text-8xl">
              {m["palmovcon2026.title"]()}
            </h1>
          </div>
        )}

        <div className="relative mx-auto mt-12 grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-8">
          <div>
            <p className="inline-flex rounded-full border border-amber-200/30 bg-amber-200/10 px-4 py-2 font-semibold text-amber-200 text-sm uppercase tracking-[0.28em]">
              {m["palmovcon2026.date"]()}
            </p>
            <p className="mt-5 max-w-2xl text-2xl text-amber-100/90">
              {m["palmovcon2026.subtitle"]()}
            </p>
            <p className="mt-8 max-w-2xl text-lg text-amber-50/80 leading-8">
              {m["palmovcon2026.intro"]()}
            </p>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Button
                asChild
                className="h-14 rounded-full bg-amber-300 px-8 font-black text-[#140b20] text-base hover:bg-amber-200"
                size="lg"
              >
                <LocalizedLink href={reservationHref}>
                  {m["palmovcon2026.reservationCta"]()}
                </LocalizedLink>
              </Button>
              <span className="text-amber-100/70 text-sm">
                {m["palmovcon2026.location"]()}
              </span>
            </div>
          </div>

          <aside className="rounded-[2rem] border border-amber-200/20 bg-black/25 p-6 shadow-2xl shadow-fuchsia-950/50 backdrop-blur">
            <h2 className="font-black text-2xl text-amber-200">
              {m["palmovcon2026.quickSummaryTitle"]()}
            </h2>
            <dl className="mt-6 grid gap-5">
              <div>
                <dt className="font-semibold text-amber-100/60 text-sm uppercase tracking-[0.2em]">
                  {m["palmovcon2026.dateLabel"]()}
                </dt>
                <dd className="mt-1 text-2xl">{m["palmovcon2026.date"]()}</dd>
              </div>
              <div>
                <dt className="font-semibold text-amber-100/60 text-sm uppercase tracking-[0.2em]">
                  {m["palmovcon2026.locationLabel"]()}
                </dt>
                <dd className="mt-1 text-2xl">{m["palmovcon2026.venue"]()}</dd>
              </div>
              <div>
                <dt className="font-semibold text-amber-100/60 text-sm uppercase tracking-[0.2em]">
                  {m["palmovcon2026.entryFeeLabel"]()}
                </dt>
                <dd className="mt-1 text-2xl">
                  {m["palmovcon2026.entryFeeShort"]()}
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-3 lg:px-8">
        <div className="rounded-3xl border border-white/10 bg-white/10 p-6 lg:col-span-1">
          <p className="font-semibold text-amber-200 text-sm uppercase tracking-[0.22em]">
            {m["palmovcon2026.practicalInfoEyebrow"]()}
          </p>
          <h2 className="mt-3 font-black text-3xl">
            {m["palmovcon2026.practicalInfoTitle"]()}
          </h2>
        </div>
        <div className="grid gap-4 lg:col-span-2 sm:grid-cols-2">
          <article className="rounded-3xl bg-amber-100 p-6 text-[#211326]">
            <h3 className="font-black text-xl">
              {m["palmovcon2026.entryFeeTitle"]()}
            </h3>
            <p className="mt-3 text-[#211326]/80">
              {m["palmovcon2026.entryFeeDescription"]()}
            </p>
          </article>
          <article className="rounded-3xl bg-fuchsia-200 p-6 text-[#211326]">
            <h3 className="font-black text-xl">
              {m["palmovcon2026.complexGamesTitle"]()}
            </h3>
            <p className="mt-3 text-[#211326]/80">
              {m["palmovcon2026.complexGamesDescription"]()}
            </p>
          </article>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-semibold text-amber-200 text-sm uppercase tracking-[0.22em]">
              {m["palmovcon2026.scheduleEyebrow"]()}
            </p>
            <h2 className="mt-3 font-black text-4xl">
              {m["palmovcon2026.scheduleTitle"]()}
            </h2>
          </div>
          <p className="max-w-xl text-amber-50/65">
            {m["palmovcon2026.scheduleDescription"]()}
          </p>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {schedule.map((item) => (
            <article
              className="rounded-[1.75rem] border border-amber-100/15 bg-[#211326] p-6 shadow-xl shadow-black/20"
              key={item.title}
            >
              <p className="font-bold text-amber-200">{item.time}</p>
              <h3 className="mt-3 font-black text-2xl">{item.title}</h3>
              <p className="mt-4 text-amber-50/75 leading-7">
                {item.description}
              </p>
              {item.note ? (
                <p className="mt-5 rounded-2xl bg-amber-300/15 px-4 py-3 font-semibold text-amber-100">
                  {item.note}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl rounded-[2rem] bg-amber-300 p-8 text-[#140b20] shadow-2xl shadow-amber-950/30 lg:p-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="font-semibold text-sm uppercase tracking-[0.22em] text-[#140b20]/70">
                {m["palmovcon2026.footerEyebrow"]()}
              </p>
              <h2 className="mt-3 font-black text-3xl">
                {m["palmovcon2026.footerTitle"]()}
              </h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                className="h-12 rounded-full bg-[#140b20] px-6 font-bold text-amber-50 hover:bg-[#2a1644]"
              >
                <a href={facebookEventHref} rel="noreferrer" target="_blank">
                  {m["palmovcon2026.facebookCta"]()}
                </a>
              </Button>
              <Button
                asChild
                className="h-12 rounded-full border-[#140b20] px-6 font-bold text-[#140b20] hover:bg-[#140b20]/10"
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
