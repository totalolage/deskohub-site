import { Tabs, usePathname } from "expo-router";
import {
  type ColorValue,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { palette } from "@/constants/Theme";
import { useShop } from "@/src/state/shop-provider";

function TabIcon({
  color,
  focused,
  name,
}: {
  color: ColorValue;
  focused: boolean;
  name: React.ComponentProps<typeof AppIcon>["name"];
}) {
  return (
    <View style={[styles.tabIcon, focused && styles.tabIconFocused]}>
      <AppIcon color={color} name={name} size={24} />
    </View>
  );
}

export default function TabLayout() {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const { loadState, session, t } = useShop();
  const hideNavigation =
    loadState !== "ready" ||
    session.kind === "signed_out" ||
    pathname.includes("/payment/");
  const wide = width >= 840;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.canvas },
        tabBarActiveTintColor: palette.navigationActive,
        tabBarInactiveTintColor: wide
          ? palette.disabledInk
          : palette.neutralInk,
        tabBarItemStyle: wide ? { minHeight: 64 } : undefined,
        tabBarLabelPosition: "below-icon",
        tabBarLabelStyle: {
          fontFamily: "HankenGrotesk",
          fontSize: 12,
          fontWeight: "600",
          lineHeight: 16,
        },
        tabBarPosition: wide ? "left" : "bottom",
        tabBarVariant: wide ? "material" : "uikit",
        tabBarStyle: {
          backgroundColor: palette.surfaceMuted,
          borderRightColor: wide ? palette.outline : undefined,
          borderTopColor: wide ? undefined : palette.outline,
          display: hideNavigation ? "none" : "flex",
          height: wide ? undefined : 64,
          paddingBottom: wide ? undefined : 4,
          paddingTop: wide ? 16 : 4,
          width: wide ? 128 : undefined,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("shopTab"),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              color={color}
              focused={focused}
              name={{
                ios: "basket",
                android: "shopping_basket",
                web: "shopping_basket",
              }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t("historyTab"),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              color={color}
              focused={focused}
              name={{
                ios: "receipt",
                android: "receipt_long",
                web: "receipt_long",
              }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t("accountTab"),
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              color={color}
              focused={focused}
              name={{
                ios: "person.crop.circle",
                android: "account_circle",
                web: "account_circle",
              }}
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

const styles = StyleSheet.create({
  tabIcon: {
    alignItems: "center",
    borderRadius: 999,
    height: 28,
    justifyContent: "center",
    width: 48,
  },
  tabIconFocused: { backgroundColor: palette.warningSurface },
});
