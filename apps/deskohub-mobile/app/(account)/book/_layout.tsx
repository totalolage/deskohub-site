import { Stack } from "expo-router";
import { useAppLocale } from "../../../src/i18n/locale-context";
import { m } from "../../../src/i18n/messages";
import { stackScreenOptions } from "../../../src/ui/navigation";

export default function BookLayout() {
  const locale = useAppLocale();
  return (
    <Stack screenOptions={stackScreenOptions(locale)}>
      <Stack.Screen
        name="index"
        options={{ title: m.booking_stack_title({}, { locale }) }}
      />
      <Stack.Screen
        name="cowork"
        options={{ title: m.booking_family_cowork_title({}, { locale }) }}
      />
      <Stack.Screen
        name="meeting-room"
        options={{ title: m.booking_family_meeting_room_title({}, { locale }) }}
      />
      <Stack.Screen
        name="office"
        options={{ title: m.booking_family_office_title({}, { locale }) }}
      />
      <Stack.Screen
        name="checkout"
        options={{ title: m.booking_stack_checkout_title({}, { locale }) }}
      />
    </Stack>
  );
}
