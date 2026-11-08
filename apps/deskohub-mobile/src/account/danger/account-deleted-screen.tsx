import { Effect } from "effect";
import { router } from "expo-router";
import { useState } from "react";
import { standaloneTaskRuntime } from "../../auth/use-auth-task";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { BodyText, Button, LiveMessage, Screen } from "../../ui/controls";
import { deletedAccountExit } from "./deleted-account-exit";

// A new sign-in waits for the deleted account's sign-out to settle: its late
// answer would clear the new session.
const backToSignIn = deletedAccountExit.settled.pipe(
  Effect.andThen(Effect.sync(() => router.replace("/sign-in")))
);

/**
 * Shown after the account was deleted and signed out. It sits outside the
 * signed-in guard and reads no customer data.
 */
export function AccountDeletedScreen() {
  const locale = useAppLocale();
  const [leaving, setLeaving] = useState(false);
  return (
    <Screen title={m.account_deleted_title({}, { locale })}>
      <BodyText>{m.danger_deleted_body({}, { locale })}</BodyText>
      <Button
        label={m.danger_deleted_sign_in({}, { locale })}
        disabled={leaving}
        onPress={() => {
          setLeaving(true);
          standaloneTaskRuntime.runFork(backToSignIn);
        }}
      />
      <LiveMessage
        role="status"
        message={leaving ? m.danger_signing_out({}, { locale }) : undefined}
      />
    </Screen>
  );
}
