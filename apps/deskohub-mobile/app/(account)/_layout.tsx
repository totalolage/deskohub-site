import { Tabs } from "expo-router";
import { useAuthSession } from "../../src/auth/use-auth-session";
import { CustomerDataProvider } from "../../src/customer-api/customer-data-provider";
import { useAppLocale } from "../../src/i18n/locale-context";
import { m } from "../../src/i18n/messages";
import { tabScreenOptions } from "../../src/ui/navigation";

/**
 * The signed-in app: Reservations and Account tabs, each its own stack, over
 * the signed-in account's own data registry.
 */
export default function AccountLayout() {
  const locale = useAppLocale();
  const session = useAuthSession();
  // The root guard mounts this group only while signed in.
  const accountId = session.status === "signed-in" ? session.user.id : "";
  return (
    <CustomerDataProvider accountId={accountId}>
      <Tabs screenOptions={tabScreenOptions}>
        <Tabs.Screen
          name="reservations"
          options={{ title: m.account_tab_reservations({}, { locale }) }}
        />
        <Tabs.Screen
          name="account"
          options={{ title: m.account_tab_account({}, { locale }) }}
        />
      </Tabs>
    </CustomerDataProvider>
  );
}
