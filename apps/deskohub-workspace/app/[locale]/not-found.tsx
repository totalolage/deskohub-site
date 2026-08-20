import Link from "next/link";
import { getLocale, m } from "@/features/i18n";

export default function NotFoundPage() {
  const locale = getLocale();

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f4f1ea] px-4 py-20 text-navy-blue">
      <div className="max-w-xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-burned-orange">
          404
        </p>
        <h1 className="mt-4 text-balance text-4xl leading-tight sm:text-5xl">
          {m.notFoundTitle({}, { locale })}
        </h1>
        <p className="mt-5 text-lg leading-8 text-navy-blue/70">
          {m.notFoundDescription({}, { locale })}
        </p>
        <Link
          href={`/${locale}`}
          className="mt-8 inline-flex min-h-11 items-center rounded-full bg-burned-orange px-6 py-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burned-orange"
        >
          {m.notFoundHomeLink({}, { locale })}
        </Link>
      </div>
    </main>
  );
}
