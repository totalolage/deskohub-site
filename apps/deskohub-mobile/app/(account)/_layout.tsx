import { Stack } from "expo-router";
import { useAuthSession } from "../../src/auth/use-auth-session";
import { CustomerDataProvider } from "../../src/customer-api/customer-data-provider";

/**
 * The signed-in app over the signed-in account's own data registry: the
 * Reservations and Account tabs, with booking stacked above them so it stays
 * out of the tab bar.
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
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="book" />
      </Stack>
    </CustomerDataProvider>
  );
}
