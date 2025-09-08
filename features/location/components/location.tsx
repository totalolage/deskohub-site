"use client";

import Link from "next/link";
import { ContactMap } from "@/features/contact";
import { getLocale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

export function Location() {
  const locale = getLocale();

  return (
    <section className="py-16 bg-gray-900">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-8 leading-tight">
              {m["locationSection.title"]()}
              <br />
              {m["locationSection.subtitle"]()}
            </h2>
            <Link href={`/${locale}/contact#map-section`}>
              <Button className="bg-transparent border-2 border-white text-white hover:bg-white hover:text-gray-900 px-8 py-3 rounded-full">
                {m["buttons.ourLocation"]()}
              </Button>
            </Link>
          </div>
          <div className="rounded-lg overflow-hidden">
            <ContactMap showTitle={false} showCard={false} />
          </div>
        </div>
      </div>
    </section>
  );
}
