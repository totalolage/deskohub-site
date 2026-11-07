import { Stack } from "expo-router";
import { useState } from "react";
import { AnalyticsRoot } from "../src/analytics/analytics-root";
import { useBrandFontReady } from "../src/brand-font";
import { readDeviceLocale } from "../src/i18n/device-locale";
import { AppLocaleProvider } from "../src/i18n/locale-context";

export default function RootLayout() {
  const [locale] = useState(readDeviceLocale);
  const brandFontReady = useBrandFontReady();

  // Waiting for the brand face keeps the first screen from flashing the
  // fallback fonts on the web.
  if (!brandFontReady) return null;

  return (
    <AppLocaleProvider locale={locale}>
      <AnalyticsRoot>
        <Stack screenOptions={{ headerShown: false }} />
      </AnalyticsRoot>
    </AppLocaleProvider>
  );
}
