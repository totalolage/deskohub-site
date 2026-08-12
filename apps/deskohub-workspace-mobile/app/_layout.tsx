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
    primary: palette.navy,
    background: palette.paper,
    card: palette.navy,
    text: palette.navy,
    border: palette.outline,
    notification: palette.orange,
  },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Sculpin: require("../assets/fonts/Sculpin-Regular.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontError, fontsLoaded]);

  if (!(fontsLoaded || fontError)) return null;

  return (
    <ShopProvider>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.paper },
          }}
        >
          <Stack.Screen name="(tabs)" />
        </Stack>
      </ThemeProvider>
    </ShopProvider>
  );
}
