import { SplashScreen, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { prepareAuthLocation } from "../src/auth/auth-location";
import { initializeBotProtection } from "../src/auth/bot-protection";
import { useAuthSession } from "../src/auth/use-auth-session";
import { readDeviceLocale } from "../src/i18n/device-locale";
import { AppLocaleProvider } from "../src/i18n/locale-context";

// Before the router or BotID read the address bar: take sign-in tokens out of
// it (web), then load BotID for the sign-in requests (web production only).
prepareAuthLocation();
initializeBotProtection();
// The splash stays up while the stored session is restored.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [locale] = useState(readDeviceLocale);
  const session = useAuthSession();
  const restoring = session.status === "restoring";

  useEffect(() => {
    if (!restoring) SplashScreen.hide();
  }, [restoring]);

  return (
    <AppLocaleProvider locale={locale}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="sign-in" />
        <Stack.Protected guard={session.status === "signed-in"}>
          <Stack.Screen name="index" />
        </Stack.Protected>
        <Stack.Screen name="auth/callback" />
        <Stack.Screen name="dev/effect-smoke" />
      </Stack>
    </AppLocaleProvider>
  );
}
