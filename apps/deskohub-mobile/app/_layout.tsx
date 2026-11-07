import { Stack } from "expo-router";
import { useState } from "react";
import { AnalyticsRoot } from "../src/analytics/analytics-root";
import { readDeviceLocale } from "../src/i18n/device-locale";
import { AppLocaleProvider } from "../src/i18n/locale-context";

export default function RootLayout() {
  const [locale] = useState(readDeviceLocale);

  return (
    <AppLocaleProvider locale={locale}>
      <AnalyticsRoot>
        <Stack screenOptions={{ headerShown: false }} />
      </AnalyticsRoot>
    </AppLocaleProvider>
  );
}
