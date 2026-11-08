import { router } from "expo-router";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { BodyText, Button, Screen } from "../../ui/controls";

/**
 * Shown after the account was deleted and signed out. It sits outside the
 * signed-in guard and reads no customer data.
 */
export function AccountDeletedScreen() {
  const locale = useAppLocale();
  return (
    <Screen title={m.account_deleted_title({}, { locale })}>
      <BodyText>{m.danger_deleted_body({}, { locale })}</BodyText>
      <Button
        label={m.danger_deleted_sign_in({}, { locale })}
        onPress={() => router.replace("/sign-in")}
      />
    </Screen>
  );
}
