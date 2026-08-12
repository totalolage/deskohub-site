import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppScreen, ScreenIntro } from "@/components/AppScreen";
import { ActionButton, StatePanel, StatusBanner } from "@/components/Controls";
import { PurchaseRow } from "@/components/PurchaseComponents";
import { spacing } from "@/constants/Theme";
import { useShop } from "@/src/state/shop-provider";

export default function HistoryScreen() {
  const { actionError, isActionPending, purchases, refreshShop, session, t } =
    useShop();

  return (
    <AppScreen refresh={() => void refreshShop()} refreshing={isActionPending}>
      <ScreenIntro title={t("historyTitle")} />
      {session.kind === "signed_out" && (
        <StatePanel
          action={
            <ActionButton
              label={t("backToShop")}
              onPress={() => router.replace("/")}
            />
          }
          mark="DW"
          title={t("signInTitle")}
        />
      )}
      {session.kind === "signed_in" && actionError && (
        <StatusBanner title={t("errorTitle")} tone="error" />
      )}
      {session.kind === "signed_in" && purchases.length === 0 && (
        <StatePanel mark="✓" title={t("historyEmptyTitle")} />
      )}
      {session.kind === "signed_in" && purchases.length > 0 && (
        <View style={styles.list}>
          {purchases.map((purchase) => (
            <PurchaseRow
              key={purchase.id}
              purchase={purchase}
              onPress={() =>
                router.push(`/purchase/${encodeURIComponent(purchase.id)}`)
              }
            />
          ))}
        </View>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});
