import { Tabs } from "expo-router";
import { useAppLocale } from "../../../src/i18n/locale-context";
import { m } from "../../../src/i18n/messages";
import { tabScreenOptions } from "../../../src/ui/navigation";

/** The Reservations and Account tabs, each its own stack. */
export default function AccountTabsLayout() {
  const locale = useAppLocale();
  return (
    <Tabs screenOptions={tabScreenOptions(locale)}>
      <Tabs.Screen
        name="reservations"
        options={{ title: m.account_tab_reservations({}, { locale }) }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: m.account_tab_account({}, { locale }) }}
      />
    </Tabs>
  );
}
