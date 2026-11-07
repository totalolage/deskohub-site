import { Stack } from "expo-router";
import { useState } from "react";
import { readDeviceLocale } from "../src/i18n/device-locale";
import { AppLocaleProvider } from "../src/i18n/locale-context";
import { UpdateBanner } from "../src/updates/update-banner";

export default function RootLayout() {
  const [locale] = useState(readDeviceLocale);

  return (
    <AppLocaleProvider locale={locale}>
      <Stack screenOptions={{ headerShown: false }} />
      <UpdateBanner />
    </AppLocaleProvider>
  );
}
