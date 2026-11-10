import { Stack } from "expo-router";
import { useAuthSession } from "../../src/auth/use-auth-session";
import { AccountConsentSyncRoot } from "../../src/consent/account-consent-sync-root";
import { CustomerDataProvider } from "../../src/customer-api/customer-data-provider";

/**
 * The signed-in app over the signed-in account's own data registry: the
 * Reservations and Account tabs, with booking (`book/`) stacked above them
 * so it stays out of the tab bar. The Stack registers routes it doesn't
 * declare, so `book/` needs no screen here. The device's analytics consent
 * follows the account while the group is mounted.
 */
export default function AccountLayout() {
  const session = useAuthSession();
  // The root guard mounts this group only while signed in.
  const accountId = session.status === "signed-in" ? session.user.id : "";
  const sessionStartedAt =
    session.status === "signed-in" ? session.signedInAt.getTime() : 0;
  return (
    <CustomerDataProvider
      accountId={accountId}
      sessionStartedAt={sessionStartedAt}
    >
      <AccountConsentSyncRoot accountId={accountId} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </CustomerDataProvider>
  );
}
