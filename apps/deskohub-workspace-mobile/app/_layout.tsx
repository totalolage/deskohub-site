import { useFonts } from "expo-font";
import { DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { palette } from "@/constants/Theme";
import { ShopProvider } from "@/src/state/shop-provider";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

void SplashScreen.preventAutoHideAsync();

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: palette.ink,
    background: palette.canvas,
    card: palette.ink,
    text: palette.ink,
    border: palette.outline,
    notification: palette.action,
  },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    HankenGrotesk: require("../assets/fonts/HankenGrotesk-Variable.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontError, fontsLoaded]);

  if (!(fontsLoaded || fontError)) return null;

  return (
    <ShopProvider>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.canvas },
          }}
        >
          <Stack.Screen name="(tabs)" />
        </Stack>
      </ThemeProvider>
    </ShopProvider>
  );
}
