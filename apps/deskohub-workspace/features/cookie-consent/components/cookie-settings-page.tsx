"use client";

import { type ReactNode, useRef, useState } from "react";
import {
  type ConsentCategory,
  useCookieConsent,
} from "@/features/cookie-consent";
import { type Locale, m } from "@/features/i18n";
import { Switch } from "@/shared/components/ui/switch";

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
  readonly additionalPreferences?: ReactNode;
}

export function CookieSettings({
  locale,
  additionalPreferences,
}: CookieSettingsProps) {
  const { acceptCategory, rejectCategory, isAccepted } = useCookieConsent();
  const preferences = {
    necessary: true,
    analytics: isAccepted("analytics"),
    marketing: isAccepted("marketing"),
    preferences: isAccepted("preferences"),
  } satisfies Record<ConsentCategory, boolean>;
  const [pendingCategories, setPendingCategories] = useState<
    ReadonlySet<ConsentCategory>
  >(() => new Set<ConsentCategory>());
  const [erroredCategory, setErroredCategory] =
    useState<ConsentCategory | null>(null);
  const pendingCategoriesRef = useRef(new Set<ConsentCategory>());

  const handleToggle = (category: ConsentCategory, nextChecked: boolean) => {
    if (category === "necessary") return;
    if (pendingCategoriesRef.current.has(category)) return;

    setErroredCategory(null);
    pendingCategoriesRef.current.add(category);
    setPendingCategories(new Set(pendingCategoriesRef.current));
    void Promise.resolve().then(async () => {
      try {
        await (nextChecked
          ? acceptCategory(category)
          : rejectCategory(category));
      } catch {
        setErroredCategory(category);
      } finally {
        pendingCategoriesRef.current.delete(category);
        setPendingCategories(new Set(pendingCategoriesRef.current));
      }
    });
  };

  return (
    <div className="mt-6 min-w-0 space-y-4">
      {consentCategories.map((category) => (
        <CookieCategoryCard
          key={category}
          category={category}
          locale={locale}
          checked={preferences[category]}
          pending={pendingCategories.has(category)}
          errored={erroredCategory === category}
          onToggle={(nextChecked) => handleToggle(category, nextChecked)}
        />
      ))}

      {additionalPreferences}
    </div>
  );
}

type CookieCategoryCardProps = {
  category: ConsentCategory;
  locale: Locale;
  checked: boolean;
  pending: boolean;
  errored: boolean;
  onToggle: (checked: boolean) => void;
};

function CookieCategoryCard({
  category,
  locale,
  checked,
  pending,
  errored,
  onToggle,
}: CookieCategoryCardProps) {
  const messages = categoryMessageGetters[category];
  const switchId = `cookie-category-${category}`;
  const descriptionId = `${switchId}-description`;
  const titleId = `${switchId}-title`;

  return (
    <article className="flex min-w-0 items-start justify-between gap-5 rounded-2xl border border-navy-blue/10 bg-[#f8f6f1] p-5 sm:p-6">
      <div className="min-w-0 flex-1 space-y-2">
        <h2 id={titleId} className="break-words text-2xl leading-tight">
          {messages.title({}, { locale })}
        </h2>
        <p
          id={descriptionId}
          className="break-words text-base leading-7 text-navy-blue/70"
        >
          {messages.description({}, { locale })}
        </p>
        {errored && (
          <p
            role="alert"
            className="text-sm font-semibold leading-6 text-red-700"
          >
            {m.errorPageTitle({}, { locale })}
          </p>
        )}
      </div>

      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onToggle}
        disabled={category === "necessary" || pending}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      />
    </article>
  );
}
