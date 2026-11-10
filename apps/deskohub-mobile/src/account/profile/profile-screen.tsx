import type {
  CustomerAccountState,
  CustomerProfile,
} from "@deskohub/workspace-customer-api";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useRouter } from "expo-router";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Button } from "../../ui/controls";
import { ListGroup, ListRow, SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import { ReturnToAccountRoot } from "../return-to-account-root";
import { AvatarSection } from "./avatar/avatar-section";
import { identityFields } from "./profile-draft";
import { ProfileTextFields } from "./profile-fields";
import {
  invalidOf,
  UnsavedChangesGuard,
  useFocusFirstInvalid,
  useProfileForm,
} from "./profile-form";
import { ProfileSubmitFooter } from "./profile-submit-footer";

/** Initials for an account without a photo, from the saved name. */
export const initialsOf = (profile: CustomerProfile) =>
  [profile.firstName, profile.lastName ?? ""]
    .map((name) => name.trim().charAt(0).toLocaleUpperCase())
    .join("");

/**
 * Profile & Identity: the verified login email, the profile photo, and the
 * name and phone of the linked account's profile. Saved language is a site
 * setting the customer API doesn't carry, so the app doesn't show it.
 */
export function ProfileScreen() {
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  return (
    <ScrollScreen refreshing={account.waiting} onRefresh={refresh}>
      <AsyncView result={account} onRetry={refresh}>
        {(current) => <LinkedProfile account={current} />}
      </AsyncView>
    </ScrollScreen>
  );
}

function LinkedProfile({
  account,
}: {
  readonly account: CustomerAccountState;
}) {
  // The Account tab explains why an account without a profile can't edit it.
  if (account.kind !== "linked") return <ReturnToAccountRoot />;
  return <ProfileForm account={account} />;
}

function ProfileForm({
  account,
}: {
  readonly account: Extract<CustomerAccountState, { kind: "linked" }>;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const form = useProfileForm(account);
  const { inputs, invalidElsewhere } = useFocusFirstInvalid(
    form.state,
    identityFields
  );
  const submitting = form.state._tag === "Submitting";
  return (
    <>
      <UnsavedChangesGuard
        unsaved={form.unsaved}
        onDiscard={form.discard}
        sharedWith={["billing"]}
        locale={locale}
      />
      <AvatarSection
        avatar={account.avatar}
        initials={initialsOf(account.profile)}
      />
      <SectionHeader title={m.profile_email_label({}, { locale })} />
      <ListGroup>
        <ListRow
          label={account.email}
          description={m.profile_email_verified({}, { locale })}
        />
      </ListGroup>
      <SectionHeader title={m.profile_identity_section({}, { locale })} />
      <ProfileTextFields
        fields={identityFields}
        draft={form.draft}
        invalid={invalidOf(form.state)}
        onChange={form.setField}
        inputs={inputs}
        editable={!submitting}
        locale={locale}
      />
      <ProfileSubmitFooter
        state={form.state}
        unsaved={form.unsaved}
        onSubmit={form.save}
        submitLabel={m.profile_save({}, { locale })}
        submittingLabel={m.profile_saving({}, { locale })}
        doneMessage={m.profile_saved({}, { locale })}
        invalidMessage={invalidMessage(invalidElsewhere, locale)}
        locale={locale}
      />
      {invalidElsewhere && (
        <Button
          label={m.account_section_billing({}, { locale })}
          variant="secondary"
          onPress={() => router.push("/account/billing")}
        />
      )}
    </>
  );
}

const invalidMessage = (elsewhere: boolean, locale: AppLocale) =>
  elsewhere
    ? m.profile_invalid_on_billing({}, { locale })
    : m.profile_validation_failed({}, { locale });
