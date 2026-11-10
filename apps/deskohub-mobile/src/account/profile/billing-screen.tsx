import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useRouter } from "expo-router";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Button } from "../../ui/controls";
import { ListGroup, ListRow, SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import { ReturnToAccountRoot } from "../return-to-account-root";
import { billingFieldsOf } from "./profile-draft";
import { BillingChoiceField, ProfileTextFields } from "./profile-fields";
import {
  invalidOf,
  UnsavedChangesGuard,
  useFocusFirstInvalid,
  useProfileForm,
} from "./profile-form";
import { ProfileSubmitFooter } from "./profile-submit-footer";

/**
 * Billing & Invoices: the billing details of the same profile draft the
 * Profile screen edits, saved whole. Saved payment methods and invoice
 * history aren't in the customer API yet, so they say so, as on the site.
 */
export function BillingScreen() {
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  return (
    <ScrollScreen refreshing={account.waiting} onRefresh={refresh}>
      <AsyncView result={account} onRetry={refresh}>
        {(current) => <LinkedBilling account={current} />}
      </AsyncView>
    </ScrollScreen>
  );
}

function LinkedBilling({
  account,
}: {
  readonly account: CustomerAccountState;
}) {
  if (account.kind !== "linked") return <ReturnToAccountRoot />;
  return <BillingForm account={account} />;
}

function BillingForm({
  account,
}: {
  readonly account: Extract<CustomerAccountState, { kind: "linked" }>;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const form = useProfileForm(account);
  const fields = billingFieldsOf(form.draft.billingKind);
  const { inputs, invalidElsewhere } = useFocusFirstInvalid(form.state, fields);
  const submitting = form.state._tag === "Submitting";
  return (
    <>
      <UnsavedChangesGuard
        unsaved={form.unsaved}
        onDiscard={form.discard}
        sharedWith={["profile"]}
        locale={locale}
      />
      <SectionHeader
        title={m.profile_payment_methods_section({}, { locale })}
      />
      <ListGroup>
        <ListRow
          label={m.profile_payment_methods_unavailable({}, { locale })}
        />
      </ListGroup>
      <SectionHeader
        title={m.profile_billing_details_section({}, { locale })}
      />
      <BillingChoiceField
        value={form.draft.billingKind}
        onChange={form.setBillingKind}
        disabled={submitting}
        locale={locale}
      />
      <ProfileTextFields
        fields={fields}
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
        invalidMessage={
          invalidElsewhere
            ? m.profile_invalid_on_profile({}, { locale })
            : m.profile_validation_failed({}, { locale })
        }
        locale={locale}
      />
      {invalidElsewhere && (
        <Button
          label={m.account_section_profile({}, { locale })}
          variant="secondary"
          onPress={() => router.push("/account/profile")}
        />
      )}
      <SectionHeader
        title={m.profile_invoice_history_section({}, { locale })}
      />
      <ListGroup>
        <ListRow
          label={m.profile_invoice_history_unavailable({}, { locale })}
        />
      </ListGroup>
    </>
  );
}
