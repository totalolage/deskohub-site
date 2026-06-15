"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ConsentCategory } from "@/features/cookie-consent";
import { useCookieConsent } from "@/features/cookie-consent";
import { getLocale } from "@/features/i18n";
import * as messages from "@/features/i18n/paraglide/messages";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";

// Helper to get cookie settings messages
const msg = (key: string): (() => string) => {
  return (messages as unknown as Record<string, () => string>)[
    `cookieSettings.${key}`
  ]!;
};

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

  // Sync with accepted categories
  useEffect(() => {
    setPreferences({
      necessary: true, // Always true
      analytics: isAccepted("analytics"),
      marketing: isAccepted("marketing"),
      preferences: isAccepted("preferences"),
    });
  }, [isAccepted]);

  const handleToggle = (category: ConsentCategory) => {
    if (category === "necessary") return; // Cannot toggle necessary cookies

    const newValue = !preferences[category];
    setPreferences((prev) => ({ ...prev, [category]: newValue }));

    if (newValue) {
      acceptCategory(category);
    } else {
      rejectCategory(category);
    }
  };

  const handleAcceptAll = () => {
    acceptAll();
    toast.success(msg("messages.saved")());
  };

  const handleRejectAll = () => {
    rejectAll();
    toast.success(msg("messages.saved")());
  };

  const categories: ConsentCategory[] = [
    "necessary",
    "analytics",
    "marketing",
    "preferences",
  ];

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="mb-8">
          <Link
            href={`/${locale}`}
            className="text-amber-600 hover:text-amber-700 mb-4 inline-block"
          >
            ← {msg("backToHome")()}
          </Link>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            {msg("title")()}
          </h1>
          <p className="text-gray-600">{msg("description")()}</p>
        </div>

        {/* Cookie Categories */}
        <div className="space-y-6 mb-8">
          {categories.map((category) => (
            <div
              key={category}
              className="bg-white rounded-lg shadow-sm p-6 border border-gray-200"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    {msg(`categories.${category}.title`)()}
                  </h2>
                  <p className="text-gray-600">
                    {msg(`categories.${category}.description`)()}
                  </p>
                </div>
                <div className="ml-4">
                  <Checkbox
                    checked={preferences[category]}
                    onCheckedChange={() => handleToggle(category)}
                    disabled={category === "necessary"}
                    aria-label={`Toggle ${category} cookies`}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-4">
          <Button
            onClick={handleAcceptAll}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {msg("buttons.acceptAll")()}
          </Button>
          <Button
            onClick={handleRejectAll}
            variant="outline"
            className="border-gray-300"
          >
            {msg("buttons.rejectAll")()}
          </Button>
        </div>
      </div>
    </div>
  );
}
