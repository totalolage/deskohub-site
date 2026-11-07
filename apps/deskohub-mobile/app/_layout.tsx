import { SplashScreen, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { AnalyticsRoot } from "../src/analytics/analytics-root";
import { initializeBotProtection } from "../src/auth/bot-protection";
import { useAuthSession } from "../src/auth/use-auth-session";
import { useBrandFontReady } from "../src/brand-font";
import { readDeviceLocale } from "../src/i18n/device-locale";
import { AppLocaleProvider } from "../src/i18n/locale-context";
import { UpdateBanner } from "../src/updates/update-banner";

// The entry (index.ts) has already taken sign-in secrets out of the address
// bar; now load BotID for the sign-in requests (web production only).
initializeBotProtection();
// The splash stays up while the stored session is restored and the brand
// face loads.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [locale] = useState(readDeviceLocale);
  const session = useAuthSession();
  const brandFontReady = useBrandFontReady();
  const ready = brandFontReady && session.status !== "restoring";

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  // Waiting for the brand face keeps the first screen from flashing the
  // fallback fonts on the web.
  if (!brandFontReady) return null;

  return (
    <AppLocaleProvider locale={locale}>
      <AnalyticsRoot>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="sign-in" />
          <Stack.Protected guard={session.status === "signed-in"}>
            <Stack.Screen name="index" />
          </Stack.Protected>
          <Stack.Screen name="auth/callback" />
          <Stack.Screen name="dev/effect-smoke" />
        </Stack>
      </AnalyticsRoot>
      <UpdateBanner />
    </AppLocaleProvider>
  );
}
