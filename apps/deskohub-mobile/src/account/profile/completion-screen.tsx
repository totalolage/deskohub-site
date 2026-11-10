import {
  accountPhoneRegion,
  type CustomerAccountState,
} from "@deskohub/workspace-customer-api";
import {
  useAtom,
  useAtomRefresh,
  useAtomSet,
  useAtomValue,
} from "@effect/atom-react";
import { Match, Option } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { useRouter } from "expo-router";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { useSettledResultReset } from "../../customer-api/settled-result-reset";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { BodyText, Button, LiveMessage } from "../../ui/controls";
import { ListGroup, ListRow, SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import { returnToAccountRoot } from "../account-root";
import { ReturnToAccountRoot } from "../return-to-account-root";
import {
  billingFieldsOf,
  type CompletionDraft,
  type CompletionTextField,
  completionDraftOf,
  identityFields,
  sameDraft,
} from "./profile-draft";
import { BillingChoiceField, ProfileTextFields } from "./profile-fields";
import {
  invalidOf,
  UnsavedChangesGuard,
  useFocusFirstInvalid,
} from "./profile-form";
import {
  completeProfileAtom,
  completionEditsAtom,
  currentCompletionDraft,
  invitationCodeOf,
  type ProfileSubmitState,
  profileSubmitState,
} from "./profile-save";
import { ProfileSubmitFooter } from "./profile-submit-footer";
import { SignupReferralNotice } from "./signup-referral-notice";

/**
 * Completing the profile of a verified email with no customer profile yet
 * (POST /account/profile): name, phone, an optional referral code and
 * optional billing details in one form. Once created, the account reads as
 * linked and the Account tab opens every section.
 */
/**
 * Whether this screen's completion made the account linked: it succeeded,
 * is still reading the account again, or couldn't be confirmed although the
 * account read again shows it applied.
 */
const createdHere = (completion: ProfileSubmitState) =>
  Match.value(completion).pipe(
    Match.tagsExhaustive({
      Idle: () => false,
      Submitting: () => true,
      Done: () => true,
      Invalid: () => false,
      Failed: ({ error }) => error._tag === "Unconfirmed",
    })
  );

export function CompletionScreen() {
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  const completion = profileSubmitState(useAtomValue(completeProfileAtom));
  useSettledResultReset(completeProfileAtom);
  return (
    <ScrollScreen refreshing={account.waiting} onRefresh={refresh}>
      <AsyncView result={account} onRetry={refresh}>
        {(current) => {
          if (current.kind === "completion-required")
            return <CompletionForm account={current} />;
          if (current.kind === "linked" && createdHere(completion))
            return <CompletionDone account={current} />;
          return <ReturnToAccountRoot />;
        }}
      </AsyncView>
    </ScrollScreen>
  );
}

function CompletionDone({
  account,
}: {
  readonly account: CustomerAccountState;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  return (
    <>
      <LiveMessage
        role="status"
        message={m.profile_complete_done({}, { locale })}
      />
      <SignupReferralNotice account={account} />
      <Button
        label={m.profile_complete_continue({}, { locale })}
        onPress={() => returnToAccountRoot(router)}
      />
    </>
  );
}

function CompletionForm({
  account,
}: {
  readonly account: Extract<
    CustomerAccountState,
    { kind: "completion-required" }
  >;
}) {
  const locale = useAppLocale();
  const invitationCode = invitationCodeOf(account);
  const phoneRegion = accountPhoneRegion(account.locale);
  const [edits, setEdits] = useAtom(completionEditsAtom);
  const result = useAtomValue(completeProfileAtom);
  const complete = useAtomSet(completeProfileAtom);
  const state = profileSubmitState(result);
  const draft = currentCompletionDraft(edits, invitationCode);
  const unsaved = !sameDraft(
    draft,
    completionDraftOf(invitationCode),
    phoneRegion
  );
  const fields: ReadonlyArray<CompletionTextField> = [
    ...identityFields,
    ...(account.referralsEnabled ? (["referralCode"] as const) : []),
    ...billingFieldsOf(draft.billingKind),
  ];
  const { inputs } = useFocusFirstInvalid(state, fields);
  const submitting = state._tag === "Submitting";
  const change = (change: Partial<CompletionDraft>) => {
    setEdits(Option.some({ ...draft, ...change }));
    if (!result.waiting) complete(Atom.Reset);
  };
  const setField = (field: CompletionTextField, value: string) =>
    change({ [field]: value });
  return (
    <>
      <UnsavedChangesGuard
        unsaved={unsaved}
        onDiscard={() => setEdits(Option.none())}
        locale={locale}
      />
      <BodyText>{m.profile_complete_intro({}, { locale })}</BodyText>
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
        draft={draft}
        invalid={invalidOf(state)}
        onChange={setField}
        inputs={inputs}
        editable={!submitting}
        locale={locale}
      />
      {account.referralsEnabled && (
        <>
          <ProfileTextFields
            fields={["referralCode"]}
            draft={draft}
            invalid={invalidOf(state)}
            onChange={setField}
            inputs={inputs}
            editable={!submitting}
            locale={locale}
          />
          <BodyText>{m.profile_referral_code_hint({}, { locale })}</BodyText>
        </>
      )}
      <SectionHeader
        title={m.profile_billing_optional_section({}, { locale })}
      />
      <BillingChoiceField
        value={draft.billingKind}
        onChange={(billingKind) => change({ billingKind })}
        disabled={submitting}
        locale={locale}
      />
      <ProfileTextFields
        fields={billingFieldsOf(draft.billingKind)}
        draft={draft}
        invalid={invalidOf(state)}
        onChange={setField}
        inputs={inputs}
        editable={!submitting}
        locale={locale}
      />
      <ProfileSubmitFooter
        state={state}
        // Created, but the account wasn't read again yet: don't create twice.
        unsaved={state._tag !== "Done"}
        onSubmit={() => complete({ draft, invitationCode, phoneRegion })}
        submitLabel={m.profile_complete_submit({}, { locale })}
        submittingLabel={m.profile_complete_submitting({}, { locale })}
        doneMessage={m.profile_complete_done({}, { locale })}
        invalidMessage={m.profile_validation_failed({}, { locale })}
        locale={locale}
      />
    </>
  );
}
