"use client";

import { getLocale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const locale = getLocale();

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f4f1ea] px-4 py-20 text-navy-blue">
      <div className="max-w-xl text-center">
        <h1 className="text-balance text-4xl leading-tight sm:text-5xl">
          {m.errorPageTitle({}, { locale })}
        </h1>
        <p className="mt-5 text-lg leading-8 text-navy-blue/70">
          {m.errorPageDescription({}, { locale })}
        </p>
        <Button className="mt-8" type="button" onClick={reset}>
          {m.errorPageRetry({}, { locale })}
        </Button>
      </div>
    </main>
  );
}
