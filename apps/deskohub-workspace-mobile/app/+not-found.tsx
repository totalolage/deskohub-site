import { router, Stack } from "expo-router";

import { AppScreen } from "@/components/AppScreen";
import { ActionButton, StatePanel } from "@/components/Controls";
import { useShop } from "@/src/state/shop-provider";

export default function NotFoundScreen() {
  const { t } = useShop();
  return (
    <AppScreen>
      <Stack.Screen options={{ title: t("appName") }} />
      <StatePanel
        action={
          <ActionButton
            label={t("returnToShop")}
            onPress={() => router.replace("/")}
          />
        }
        mark="?"
        title={t("errorTitle")}
      />
    </AppScreen>
  );
}
