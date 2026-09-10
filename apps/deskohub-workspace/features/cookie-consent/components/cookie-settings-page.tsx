"use client";

import {
  type ConsentCategory,
  useCookieConsent,
} from "@/features/cookie-consent";
import { type Locale, m } from "@/features/i18n";
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

export interface CookieSettingsProps {
  readonly locale: Locale;
}

export function CookieSettings({ locale }: CookieSettingsProps) {
  const { acceptAll, rejectAll, acceptCategory, rejectCategory, isAccepted } =
    useCookieConsent();
  const preferences = {
    necessary: true,
    analytics: isAccepted("analytics"),
    marketing: isAccepted("marketing"),
    preferences: isAccepted("preferences"),
  } satisfies Record<ConsentCategory, boolean>;

  const handleToggle = (
    category: ConsentCategory,
    checked: boolean | "indeterminate"
  ) => {
    if (category === "necessary") return;

    if (checked === true) {
      acceptCategory(category);
      return;
    }

    rejectCategory(category);
  };

  return (
    <div className="mt-6 min-w-0 space-y-4">
      {consentCategories.map((category) => (
        <CookieCategoryCard
          key={category}
          category={category}
          locale={locale}
          checked={preferences[category]}
          onToggle={(nextChecked) => handleToggle(category, nextChecked)}
        />
      ))}

      <div className="flex min-w-0 flex-wrap gap-4 pt-2">
        <Button
          onClick={acceptAll}
          type="button"
          className="h-12 max-w-full whitespace-normal px-6 text-left text-xs uppercase tracking-[0.16em]"
        >
          {m.cookieSettingsAcceptAll({}, { locale })}
        </Button>
        <Button
          onClick={rejectAll}
          type="button"
          variant="secondary"
          className="h-12 max-w-full whitespace-normal px-6 text-left text-xs uppercase tracking-[0.16em]"
        >
          {m.cookieSettingsRejectAll({}, { locale })}
        </Button>
      </div>
    </div>
  );
}

type CookieCategoryCardProps = {
  category: ConsentCategory;
  locale: Locale;
  checked: boolean;
  onToggle: (checked: boolean | "indeterminate") => void;
};

function CookieCategoryCard({
  category,
  locale,
  checked,
  onToggle,
}: CookieCategoryCardProps) {
  const messages = categoryMessageGetters[category];
  const checkboxId = `cookie-category-${category}`;
  const descriptionId = `${checkboxId}-description`;
  const stateId = `${checkboxId}-state`;
  const titleId = `${checkboxId}-title`;

  return (
    <article className="flex min-w-0 flex-col gap-5 rounded-[1.5rem] border border-navy-blue/10 bg-[#f8f6f1] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
      <div className="min-w-0 max-w-2xl space-y-2">
        <h2 id={titleId} className="break-words text-2xl leading-tight">
          {messages.title({}, { locale })}
        </h2>
        <p
          id={descriptionId}
          className="break-words text-base leading-7 text-navy-blue/70"
        >
          {messages.description({}, { locale })}
        </p>
      </div>

      <div className="inline-flex max-w-full min-w-0 flex-wrap items-center gap-3 text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue">
        <Checkbox
          id={checkboxId}
          checked={checked}
          onCheckedChange={onToggle}
          disabled={category === "necessary"}
          aria-describedby={descriptionId}
          aria-labelledby={`${titleId} ${stateId}`}
        />
        <label
          id={stateId}
          htmlFor={checkboxId}
          className="cursor-pointer break-words"
        >
          {checked
            ? m.cookieSettingsToggleEnabled({}, { locale })
            : m.cookieSettingsToggleDisabled({}, { locale })}
        </label>
      </div>
    </article>
  );
}
