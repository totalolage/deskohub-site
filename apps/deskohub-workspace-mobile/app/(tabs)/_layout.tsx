import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useWindowDimensions } from "react-native";

import { palette } from "@/constants/Theme";
import { useShop } from "@/src/state/shop-provider";

export default function TabLayout() {
  const { width } = useWindowDimensions();
  const { loadState, session, t } = useShop();
  const hideNavigation = loadState !== "ready" || session.kind === "signed_out";
  const wide = width >= 840;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.paper },
        tabBarActiveTintColor: wide ? palette.sunset : palette.navy,
        tabBarInactiveTintColor: wide ? "#D7D7E5" : palette.navyMuted,
        tabBarItemStyle: wide ? { minHeight: 76 } : undefined,
        tabBarLabelPosition: "below-icon",
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
        tabBarPosition: wide ? "left" : "bottom",
        tabBarVariant: wide ? "material" : "uikit",
        tabBarStyle: {
          backgroundColor: wide ? palette.navy : palette.surface,
          borderRightColor: wide ? palette.navy : undefined,
          borderTopColor: wide ? undefined : palette.outline,
          display: hideNavigation ? "none" : "flex",
          height: wide ? undefined : 76,
          paddingBottom: wide ? undefined : 10,
          paddingTop: wide ? 24 : 8,
          width: wide ? 144 : undefined,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("shopTab"),
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: "basket",
                android: "shopping_basket",
                web: "shopping_basket",
              }}
              size={24}
              tintColor={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t("historyTab"),
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: "receipt",
                android: "receipt_long",
                web: "receipt_long",
              }}
              size={24}
              tintColor={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t("accountTab"),
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: "person.crop.circle",
                android: "account_circle",
                web: "account_circle",
              }}
              size={24}
              tintColor={color}
            />
          ),
        }}
      />
      <Tabs.Screen name="cart" options={{ href: null }} />
      <Tabs.Screen name="payment/[orderId]" options={{ href: null }} />
      <Tabs.Screen name="purchase/[orderId]" options={{ href: null }} />
    </Tabs>
  );
}
