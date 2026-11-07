import { Stack } from "expo-router";
import { useAppLocale } from "../../../../src/i18n/locale-context";
import { m } from "../../../../src/i18n/messages";
import { stackScreenOptions } from "../../../../src/ui/navigation";

export default function ReservationsLayout() {
  const locale = useAppLocale();
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="index"
        options={{ title: m.account_section_reservations({}, { locale }) }}
      />
      <Stack.Screen
        name="[orderId]/index"
        options={{ title: m.reservations_status_title({}, { locale }) }}
      />
      <Stack.Screen
        name="[orderId]/access"
        options={{ title: m.reservations_access_title({}, { locale }) }}
      />
    </Stack>
  );
}
