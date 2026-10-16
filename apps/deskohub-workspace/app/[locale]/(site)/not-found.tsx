import Link from "next/link";
import { m } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { Button } from "@/shared/components/ui/button";

export default async function NotFoundPage() {
  const locale = await getRequestLocale();

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
        <Button asChild className="mt-8">
          <Link href={`/${locale}`}>{m.notFoundHomeLink({}, { locale })}</Link>
        </Button>
      </div>
    </main>
  );
}
