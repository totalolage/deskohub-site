import { notFound } from "next/navigation";
import { connection } from "next/server";
import { setLocale } from "@/features/i18n";
import { LocalizedLink } from "@/features/i18n/components/localized-link";
import { Button } from "@/shared/components/ui/button";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../../../route";
import { isPalmovconPageExpired } from "./page-availability";

const reservationHref = "/reservation?message=Palmovcon";
const facebookEventHref = "https://www.facebook.com/share/1D39ZcqBkS/";

const schedule = [
  {
    title: "Workshop malování figurek",
    time: "Čtvrtek 16. 7. v 17:00",
    description:
      "Chceš si vyzkoušet nabarvit vlastní miniaturu? Barvy i figurky ti rádi půjčíme, stačí dorazit!",
  },
  {
    title: "Otevřené hraní Zaklínače",
    time: "Čtvrtek 16. 7. v 17:00",
    description:
      "Legendární fantasy svět na tvém stole. Kapacita je omezená a registrace je nutná předem.",
    note: "Registrační formulář doplníme brzy.",
  },
  {
    title: "Krvavá hodinka (Blood on the Clocktower)",
    time: "Sobota 18. 7. ve 12:00",
    description: "Geniální detektivní hra plná blafování, dedukce a intrik.",
    note: "Registrace bude spuštěna již brzy.",
  },
  {
    title: "Velká deskoherní burza",
    time: "Sobota 18. 7. celý den",
    description:
      "Praskají ti doma poličky ve švech? Přines hry, které už nehraješ, nebo přijď ulovit nový kousek za super cenu.",
  },
];

export const generateMetadata = metadata({
  title: "Palmovcon 2026",
  description:
    "Druhý ročník deskoherního festivalu na Palmovce v Deskohubu od 16. do 19. července 2026.",
});

export default async function Palmovcon2026Page({ params }: RouteProps_locale) {
  const { locale } = await params;
  setLocale(locale, { reload: false });

  await connection();
  if (isPalmovconPageExpired()) {
    notFound();
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#140b20] text-amber-50">
      <section className="relative px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.35),_transparent_34%),radial-gradient(circle_at_80%_10%,_rgba(217,70,239,0.28),_transparent_30%),linear-gradient(135deg,_rgba(20,11,32,0.95),_rgba(48,16,72,0.92))]" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#140b20] to-transparent" />

        <div className="relative mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="mb-4 inline-flex rounded-full border border-amber-200/30 bg-amber-200/10 px-4 py-2 font-semibold text-amber-200 text-sm uppercase tracking-[0.28em]">
              16. 7. - 19. 7. 2026
            </p>
            <h1 className="max-w-4xl font-black text-5xl tracking-tight sm:text-7xl lg:text-8xl">
              PALMOVCON 2026
            </h1>
            <p className="mt-5 max-w-2xl text-2xl text-amber-100/90">
              Druhý ročník deskoherního festivalu na Palmovce.
            </p>
            <p className="mt-8 max-w-2xl text-lg text-amber-50/80 leading-8">
              Potkej svého osudového spoluhráče. Ať už jsi hardcore stratég,
              tvořivý geek, nebo celá nerdská rodina, doraz nasát tu správnou
              letní herní atmosféru. Nemusíš číst tlusté manuály, naši herní
              průvodci tě všechno naučí přímo u stolu.
            </p>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Button
                asChild
                className="h-14 rounded-full bg-amber-300 px-8 font-black text-[#140b20] text-base hover:bg-amber-200"
                size="lg"
              >
                <LocalizedLink href={reservationHref}>
                  Chci si rezervovat stůl
                </LocalizedLink>
              </Button>
              <span className="text-amber-100/70 text-sm">
                Deskohub, Praha - Palmovka
              </span>
            </div>
          </div>

          <aside className="rounded-[2rem] border border-amber-200/20 bg-black/25 p-6 shadow-2xl shadow-fuchsia-950/50 backdrop-blur">
            <h2 className="font-black text-2xl text-amber-200">
              Nejrychlejší přehled
            </h2>
            <dl className="mt-6 grid gap-5">
              <div>
                <dt className="font-semibold text-amber-100/60 text-sm uppercase tracking-[0.2em]">
                  Kdy
                </dt>
                <dd className="mt-1 text-2xl">16. 7. - 19. 7. 2026</dd>
              </div>
              <div>
                <dt className="font-semibold text-amber-100/60 text-sm uppercase tracking-[0.2em]">
                  Kde
                </dt>
                <dd className="mt-1 text-2xl">Deskohub na Palmovce</dd>
              </div>
              <div>
                <dt className="font-semibold text-amber-100/60 text-sm uppercase tracking-[0.2em]">
                  Vstupné
                </dt>
                <dd className="mt-1 text-2xl">
                  50 Kč s konzumací / 100 Kč bez
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-3 lg:px-8">
        <div className="rounded-3xl border border-white/10 bg-white/10 p-6 lg:col-span-1">
          <p className="font-semibold text-amber-200 text-sm uppercase tracking-[0.22em]">
            Praktické info
          </p>
          <h2 className="mt-3 font-black text-3xl">Jak to funguje</h2>
        </div>
        <div className="grid gap-4 lg:col-span-2 sm:grid-cols-2">
          <article className="rounded-3xl bg-amber-100 p-6 text-[#211326]">
            <h3 className="font-black text-xl">Vstupné</h3>
            <p className="mt-3 text-[#211326]/80">
              Standardní jako do Deskohubu: 50 Kč za osobu při konzumaci na
              baru, 100 Kč za osobu, pokud si nic nedáte.
            </p>
          </article>
          <article className="rounded-3xl bg-fuchsia-200 p-6 text-[#211326]">
            <h3 className="font-black text-xl">Komplexní hry</h3>
            <p className="mt-3 text-[#211326]/80">
              Chceš si zahrát něco náročnějšího? Zápis na vysvětlení pravidel
              doplníme brzy.
            </p>
          </article>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-semibold text-amber-200 text-sm uppercase tracking-[0.22em]">
              Program akce
            </p>
            <h2 className="mt-3 font-black text-4xl">Co se bude hrát</h2>
          </div>
          <p className="max-w-xl text-amber-50/65">
            Program stále doplňujeme a ladíme. Registrace otevřeme postupně.
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
                Sledujte nás a buďte v obraze
              </p>
              <h2 className="mt-3 font-black text-3xl">
                Neuteče vám žádná novinka ani další registrace.
              </h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                className="h-12 rounded-full bg-[#140b20] px-6 font-bold text-amber-50 hover:bg-[#2a1644]"
              >
                <a href={facebookEventHref} rel="noreferrer" target="_blank">
                  Zobrazit Facebook událost
                </a>
              </Button>
              <Button
                asChild
                className="h-12 rounded-full border-[#140b20] px-6 font-bold text-[#140b20] hover:bg-[#140b20]/10"
                variant="outline"
              >
                <LocalizedLink href={reservationHref}>
                  Rezervovat stůl
                </LocalizedLink>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
