import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";

import { palette } from "@/constants/Theme";
import { useShop } from "@/src/state/shop-provider";

export default function TabLayout() {
  const { loadState, session, t } = useShop();
  const hideNavigation = loadState !== "ready" || session.kind === "signed_out";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.paper },
        tabBarActiveTintColor: palette.navy,
        tabBarInactiveTintColor: palette.navyMuted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.silver,
          display: hideNavigation ? "none" : "flex",
          height: 72,
          paddingBottom: 10,
          paddingTop: 8,
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
    </Tabs>
  );
}
