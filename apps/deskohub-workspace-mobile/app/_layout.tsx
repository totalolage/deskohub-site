import { DarkTheme, Stack, ThemeProvider } from "expo-router";
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
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: palette.aquamarine,
    background: palette.paper,
    card: palette.navy,
    text: palette.white,
    border: palette.navy,
    notification: palette.orange,
  },
};

export default function RootLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <ShopProvider>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.paper },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="cart" />
          <Stack.Screen name="payment/[orderId]" />
          <Stack.Screen name="purchase/[orderId]" />
        </Stack>
      </ThemeProvider>
    </ShopProvider>
  );
}
