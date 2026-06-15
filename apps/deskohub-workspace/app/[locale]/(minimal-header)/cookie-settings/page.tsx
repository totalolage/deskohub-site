"use client";

import { useEffect, useState } from "react";
import {
  type ConsentCategory,
  useCookieConsent,
} from "@/features/cookie-consent";
import { getLocale, m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";

const consentCategories: ConsentCategory[] = [
  "necessary",
  "analytics",
  "marketing",
  "preferences",
];

const categoryMessageGetters = {
  necessary: {
    title: m.cookieSettingsNecessaryTitle,
    description: m.cookieSettingsNecessaryDescription,
  },
  analytics: {
    title: m.cookieSettingsAnalyticsTitle,
    description: m.cookieSettingsAnalyticsDescription,
  },
  marketing: {
    title: m.cookieSettingsMarketingTitle,
    description: m.cookieSettingsMarketingDescription,
  },
  preferences: {
    title: m.cookieSettingsPreferencesTitle,
    description: m.cookieSettingsPreferencesDescription,
  },
} as const;

export default function CookieSettingsPage() {
  const locale = getLocale();
  const { acceptAll, rejectAll, acceptCategory, rejectCategory, isAccepted } =
    useCookieConsent();
  const [preferences, setPreferences] = useState<
    Record<ConsentCategory, boolean>
  >({
    necessary: true,
    analytics: false,
    marketing: false,
    preferences: false,
  });

  useEffect(() => {
    setPreferences({
      necessary: true,
      analytics: isAccepted("analytics"),
      marketing: isAccepted("marketing"),
      preferences: isAccepted("preferences"),
    });
  }, [isAccepted]);

  const handleToggle = (category: ConsentCategory) => {
    if (category === "necessary") return;

    const nextValue = !preferences[category];
    setPreferences((current) => ({ ...current, [category]: nextValue }));

    if (nextValue) {
      acceptCategory(category);
      return;
    }

    rejectCategory(category);
  };

  return (
    <main className="min-h-screen overflow-x-clip bg-[#f4f1ea] text-navy-blue">
      <section className="relative isolate overflow-hidden pb-20 pt-28 sm:pb-24 sm:pt-36">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(236,164,35,0.18),transparent_28%),radial-gradient(circle_at_right,rgba(0,223,153,0.1),transparent_26%),linear-gradient(180deg,#08154a_0%,#10205a_30%,#f4f1ea_30%,#f4f1ea_100%)]" />

        <Container>
          <div className="mx-auto max-w-4xl rounded-[2rem] border border-white/60 bg-white/92 p-8 shadow-[0_40px_120px_-52px_rgba(0,2,79,0.55)] backdrop-blur-sm sm:p-12">
            <div className="mt-6 space-y-4">
              <h1 className="text-balance text-4xl leading-none sm:text-5xl">
                {m.cookieSettingsTitle({}, { locale })}
              </h1>
              <p className="max-w-3xl text-base leading-7 text-navy-blue/72 sm:text-lg">
                {m.cookieSettingsDescription({}, { locale })}
              </p>
            </div>

            <div className="mt-10 space-y-4">
              {consentCategories.map((category) => (
                <CookieCategoryCard
                  key={category}
                  category={category}
                  locale={locale}
                  checked={preferences[category]}
                  onToggle={() => handleToggle(category)}
                />
              ))}
            </div>

            <div className="mt-10 flex flex-wrap gap-4">
              <Button
                onClick={acceptAll}
                className="h-12 px-6 text-xs uppercase tracking-[0.16em]"
              >
                {m.cookieSettingsAcceptAll({}, { locale })}
              </Button>
              <Button
                onClick={rejectAll}
                variant="secondary"
                className="h-12 px-6 text-xs uppercase tracking-[0.16em]"
              >
                {m.cookieSettingsRejectAll({}, { locale })}
              </Button>
            </div>
          </div>
        </Container>
      </section>
    </main>
  );
}

type CookieCategoryCardProps = {
  category: ConsentCategory;
  locale: ReturnType<typeof getLocale>;
  checked: boolean;
  onToggle: () => void;
};

function CookieCategoryCard({
  category,
  locale,
  checked,
  onToggle,
}: CookieCategoryCardProps) {
  const messages = categoryMessageGetters[category];
  const checkboxId = `cookie-category-${category}`;

  return (
    <article className="flex flex-col gap-5 rounded-[1.5rem] border border-navy-blue/10 bg-[#f8f6f1] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
      <div className="max-w-2xl space-y-2">
        <h2 className="text-2xl leading-tight">
          {messages.title({}, { locale })}
        </h2>
        <p className="text-base leading-7 text-navy-blue/70">
          {messages.description({}, { locale })}
        </p>
      </div>

      <div className="inline-flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue">
        <Checkbox
          id={checkboxId}
          checked={checked}
          onCheckedChange={onToggle}
          disabled={category === "necessary"}
        />
        <label htmlFor={checkboxId} className="cursor-pointer">
          {checked
            ? m.cookieSettingsToggleEnabled({}, { locale })
            : m.cookieSettingsToggleDisabled({}, { locale })}
        </label>
      </div>
    </article>
  );
}
