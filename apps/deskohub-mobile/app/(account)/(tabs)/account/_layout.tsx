import { Stack } from "expo-router";
import { useAppLocale } from "../../../../src/i18n/locale-context";
import { m } from "../../../../src/i18n/messages";
import { stackScreenOptions } from "../../../../src/ui/navigation";

// A link straight to a deeper screen, such as a reservation from a payment
// return, keeps this stack's index behind it for Back.
export const unstable_settings = { anchor: "index" };

export default function AccountSectionsLayout() {
  const locale = useAppLocale();
  return (
    <Stack screenOptions={stackScreenOptions(locale)}>
      <Stack.Screen
        name="index"
        options={{ title: m.account_tab_account({}, { locale }) }}
      />
      <Stack.Screen
        name="profile"
        options={{ title: m.account_section_profile({}, { locale }) }}
      />
      <Stack.Screen
        name="language"
        options={{ title: m.account_section_language({}, { locale }) }}
      />
      <Stack.Screen
        name="billing"
        options={{ title: m.account_section_billing({}, { locale }) }}
      />
      <Stack.Screen
        name="complete"
        options={{ title: m.account_section_complete({}, { locale }) }}
      />
      <Stack.Screen
        name="security"
        options={{ title: m.account_section_security({}, { locale }) }}
      />
      <Stack.Screen
        name="assistants"
        options={{ title: m.account_section_assistants({}, { locale }) }}
      />
      <Stack.Screen
        name="legal"
        options={{ title: m.account_section_legal({}, { locale }) }}
      />
      <Stack.Screen
        name="referrals"
        options={{ title: m.account_section_referrals({}, { locale }) }}
      />
      <Stack.Screen
        name="danger"
        options={{ title: m.account_section_danger({}, { locale }) }}
      />
    </Stack>
  );
}
