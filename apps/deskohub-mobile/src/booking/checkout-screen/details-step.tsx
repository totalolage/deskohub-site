import { Option } from "effect";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { ChoiceList } from "../../ui/choice-list";
import { BodyText, Button, TextField } from "../../ui/controls";
import { ListGroup, ListRow, SectionHeader } from "../../ui/list";
import { Notice } from "../../ui/notice";
import { Text } from "../../ui/text";
import type {
  CheckoutDetails,
  DetailsNotice,
} from "../checkout/checkout-state";
import { Checkbox } from "../ui/checkbox";
import { retryMessage } from "./checkout-copy";
import {
  type BillingChoice,
  type DetailsDraft,
  type DetailsField,
  type DetailsFieldProblems,
  detailsFieldOf,
  type FieldProblem,
  type SelfContact,
  validateDetails,
  withRejectedSavedFields,
} from "./details-form";

type Locale = { readonly locale: AppLocale };

/**
 * Who books and what the invoice needs. A linked profile books "as" itself
 * (read-only, asking only for a missing phone); booking for someone else
 * asks for their name, email twice and phone. Billing is chosen here in
 * both modes, as on the site.
 */
export function DetailsStep({
  self,
  draft,
  onDraftChange,
  notice,
  busy,
  onContinue,
  onRetry,
  locale,
}: Locale & {
  readonly self: SelfContact;
  readonly draft: DetailsDraft;
  readonly onDraftChange: (draft: DetailsDraft) => void;
  readonly notice: Option.Option<DetailsNotice>;
  /** The hold is being created: the form holds still. */
  readonly busy: boolean;
  readonly onContinue: (details: CheckoutDetails) => void;
  readonly onRetry: () => void;
}) {
  const [problems, setProblems] = useState<DetailsFieldProblems>({});
  const serverField = notice.pipe(
    Option.flatMap((shown) =>
      shown._tag === "DetailsInvalid"
        ? detailsFieldOf(shown.field)
        : Option.none()
    )
  );
  // A saved name or phone the server rejected stays editable from then on.
  const [rejectedSaved, setRejectedSaved] = useState<
    ReadonlySet<"name" | "phone">
  >(new Set());
  const rejectedNow = Option.filter(
    serverField,
    (field): field is "name" | "phone" =>
      draft.bookingFor === "self" && (field === "name" || field === "phone")
  );
  const contact = withRejectedSavedFields(
    self,
    Option.match(rejectedNow, {
      onNone: () => rejectedSaved,
      onSome: (field) => new Set([...rejectedSaved, field]),
    })
  );
  const shownProblems: DetailsFieldProblems = Option.match(serverField, {
    onNone: () => problems,
    onSome: (field) => ({ ...problems, [field]: "invalid" }),
  });
  const fieldProps = (field: DetailsField) => ({
    problem: shownProblems[field],
    editable: !busy,
    locale,
  });
  const submit = () => {
    if (Option.isSome(rejectedNow)) {
      setRejectedSaved(new Set([...rejectedSaved, rejectedNow.value]));
    }
    const validation = validateDetails(contact, draft);
    if (validation._tag === "Invalid") {
      setProblems(validation.problems);
      return;
    }
    setProblems({});
    onContinue(validation.details);
  };
  const someoneElse = draft.someoneElse;
  const setSomeoneElse = (patch: Partial<DetailsDraft["someoneElse"]>) =>
    onDraftChange({ ...draft, someoneElse: { ...someoneElse, ...patch } });
  return (
    <View style={styles.step}>
      <ChoiceList
        label={m.booking_checkout_booking_for_label({}, { locale })}
        choices={[
          {
            value: "self",
            label: m.booking_checkout_booking_for_self({}, { locale }),
          },
          {
            value: "someone-else",
            label: m.booking_checkout_booking_for_someone_else({}, { locale }),
          },
        ]}
        selected={draft.bookingFor}
        onSelect={(bookingFor) => onDraftChange({ ...draft, bookingFor })}
        disabled={busy}
      />
      {draft.bookingFor === "self" ? (
        <SelfFields
          self={contact}
          draft={draft}
          onDraftChange={onDraftChange}
          fieldProps={fieldProps}
          locale={locale}
        />
      ) : (
        <View style={styles.fields}>
          <Field
            label={m.booking_checkout_field_name({}, { locale })}
            value={someoneElse.name}
            onChangeText={(name) => setSomeoneElse({ name })}
            autoComplete="name"
            textContentType="name"
            {...fieldProps("name")}
          />
          <Field
            label={m.booking_checkout_field_email({}, { locale })}
            value={someoneElse.email}
            onChangeText={(email) => setSomeoneElse({ email })}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            {...fieldProps("email")}
          />
          <Field
            label={m.booking_checkout_field_email_repeat({}, { locale })}
            value={someoneElse.emailRepeat}
            onChangeText={(emailRepeat) => setSomeoneElse({ emailRepeat })}
            keyboardType="email-address"
            {...fieldProps("emailRepeat")}
          />
          <Field
            label={m.booking_checkout_field_phone({}, { locale })}
            value={someoneElse.phone}
            onChangeText={(phone) => setSomeoneElse({ phone })}
            autoComplete="tel"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            {...fieldProps("phone")}
          />
        </View>
      )}
      <BillingFields
        draft={draft}
        onDraftChange={onDraftChange}
        fieldProps={fieldProps}
        busy={busy}
        locale={locale}
      />
      {draft.bookingFor === "self" && (
        <Checkbox
          label={m.booking_checkout_marketing_consent({}, { locale })}
          checked={draft.marketingConsent}
          onChange={(marketingConsent) =>
            onDraftChange({ ...draft, marketingConsent })
          }
          disabled={busy}
        />
      )}
      <DetailsNoticeView
        notice={notice}
        busy={busy}
        onRetry={onRetry}
        locale={locale}
      />
      <Notice
        tone="error"
        message={
          Object.keys(problems).length > 0
            ? m.booking_checkout_details_check_fields({}, { locale })
            : undefined
        }
      />
      <Button
        label={
          busy
            ? m.booking_checkout_creating({}, { locale })
            : m.booking_checkout_continue({}, { locale })
        }
        onPress={submit}
        disabled={busy}
      />
    </View>
  );
}

type FieldPropsOf = (field: DetailsField) => {
  readonly problem: FieldProblem | undefined;
  readonly editable: boolean;
  readonly locale: AppLocale;
};

function SelfFields({
  self,
  draft,
  onDraftChange,
  fieldProps,
  locale,
}: Locale & {
  readonly self: SelfContact;
  readonly draft: DetailsDraft;
  readonly onDraftChange: (draft: DetailsDraft) => void;
  readonly fieldProps: FieldPropsOf;
}) {
  const setSelf = (patch: Partial<DetailsDraft["self"]>) =>
    onDraftChange({ ...draft, self: { ...draft.self, ...patch } });
  return (
    <View style={styles.fields}>
      <SectionHeader title={m.booking_checkout_booking_as({}, { locale })} />
      <ListGroup>
        {Option.isSome(self.name) && (
          <ListRow
            label={m.booking_checkout_field_name({}, { locale })}
            value={self.name.value}
          />
        )}
        <ListRow
          label={m.booking_checkout_field_email({}, { locale })}
          value={self.email}
        />
        {Option.isSome(self.phone) && (
          <ListRow
            label={m.booking_checkout_field_phone({}, { locale })}
            value={self.phone.value}
          />
        )}
      </ListGroup>
      {Option.isNone(self.name) && (
        <BodyText>{m.booking_checkout_profile_hint({}, { locale })}</BodyText>
      )}
      {Option.isNone(self.name) && (
        <Field
          label={m.booking_checkout_field_name({}, { locale })}
          value={draft.self.name}
          onChangeText={(name) => setSelf({ name })}
          autoComplete="name"
          textContentType="name"
          {...fieldProps("name")}
        />
      )}
      {Option.isNone(self.phone) && (
        <Field
          label={m.booking_checkout_field_phone({}, { locale })}
          value={draft.self.phone}
          onChangeText={(phone) => setSelf({ phone })}
          autoComplete="tel"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          {...fieldProps("phone")}
        />
      )}
    </View>
  );
}

function BillingFields({
  draft,
  onDraftChange,
  fieldProps,
  busy,
  locale,
}: Locale & {
  readonly draft: DetailsDraft;
  readonly onDraftChange: (draft: DetailsDraft) => void;
  readonly fieldProps: FieldPropsOf;
  readonly busy: boolean;
}) {
  const setAddress = (patch: Partial<DetailsDraft["address"]>) =>
    onDraftChange({ ...draft, address: { ...draft.address, ...patch } });
  const setBuyer = (patch: Partial<DetailsDraft["buyer"]>) =>
    onDraftChange({ ...draft, buyer: { ...draft.buyer, ...patch } });
  const choices: ReadonlyArray<{ value: BillingChoice; label: string }> = [
    { value: "none", label: m.booking_checkout_billing_none({}, { locale }) },
    {
      value: "personal-invoice",
      label: m.booking_checkout_billing_personal_invoice({}, { locale }),
    },
    {
      value: "business",
      label: m.booking_checkout_billing_business({}, { locale }),
    },
  ];
  return (
    <View style={styles.fields}>
      <SectionHeader
        title={m.booking_checkout_billing_heading({}, { locale })}
      />
      <ChoiceList
        label={m.booking_checkout_billing_heading({}, { locale })}
        choices={choices}
        selected={draft.billing}
        onSelect={(billing) => onDraftChange({ ...draft, billing })}
        disabled={busy}
      />
      {draft.billing === "business" && (
        <>
          <Field
            label={m.booking_checkout_field_company_name({}, { locale })}
            value={draft.buyer.legalName}
            onChangeText={(legalName) => setBuyer({ legalName })}
            autoComplete="organization"
            {...fieldProps("buyer.legalName")}
          />
          <Field
            label={m.booking_checkout_field_company_id({}, { locale })}
            value={draft.buyer.companyId}
            onChangeText={(companyId) => setBuyer({ companyId })}
            {...fieldProps("buyer.companyId")}
          />
          <Field
            label={m.booking_checkout_field_vat_id({}, { locale })}
            value={draft.buyer.vatId}
            onChangeText={(vatId) => setBuyer({ vatId })}
            {...fieldProps("buyer.vatId")}
          />
        </>
      )}
      {draft.billing !== "none" && (
        <>
          <Field
            label={m.booking_checkout_field_address_line1({}, { locale })}
            value={draft.address.line1}
            onChangeText={(line1) => setAddress({ line1 })}
            autoComplete="address-line1"
            {...fieldProps("address.line1")}
          />
          <Field
            label={m.booking_checkout_field_address_line2({}, { locale })}
            value={draft.address.line2}
            onChangeText={(line2) => setAddress({ line2 })}
            autoComplete="address-line2"
            {...fieldProps("address.line2")}
          />
          <Field
            label={m.booking_checkout_field_city({}, { locale })}
            value={draft.address.city}
            onChangeText={(city) => setAddress({ city })}
            {...fieldProps("address.city")}
          />
          <Field
            label={m.booking_checkout_field_postal_code({}, { locale })}
            value={draft.address.postalCode}
            onChangeText={(postalCode) => setAddress({ postalCode })}
            autoComplete="postal-code"
            {...fieldProps("address.postalCode")}
          />
          <Field
            label={m.booking_checkout_field_country({}, { locale })}
            value={draft.address.country}
            onChangeText={(country) => setAddress({ country })}
            {...fieldProps("address.country")}
          />
        </>
      )}
    </View>
  );
}

/** A text field with the problem the last check found below it. */
function Field({
  problem,
  locale,
  ...input
}: Locale &
  Parameters<typeof TextField>[0] & {
    readonly problem: FieldProblem | undefined;
  }) {
  return (
    <View style={styles.field}>
      <TextField {...input} />
      {problem !== undefined && (
        <Text style={styles.problem}>
          {fieldProblemMessage(problem, locale)}
        </Text>
      )}
    </View>
  );
}

const fieldProblemMessage = (problem: FieldProblem, locale: AppLocale) =>
  ({
    required: () => m.booking_checkout_field_required({}, { locale }),
    too_short: () => m.booking_checkout_field_too_short({}, { locale }),
    too_long: () => m.booking_checkout_field_too_long({}, { locale }),
    invalid_email: () => m.booking_checkout_field_invalid_email({}, { locale }),
    emails_differ: () => m.booking_checkout_field_emails_differ({}, { locale }),
    invalid_phone: () => m.booking_checkout_field_invalid_phone({}, { locale }),
    invalid_country: () =>
      m.booking_checkout_field_invalid_country({}, { locale }),
    invalid: () => m.booking_checkout_field_invalid({}, { locale }),
  })[problem]();

function DetailsNoticeView({
  notice,
  busy,
  onRetry,
  locale,
}: Locale & {
  readonly notice: Option.Option<DetailsNotice>;
  readonly busy: boolean;
  readonly onRetry: () => void;
}) {
  const shown = Option.getOrUndefined(notice);
  const message =
    shown === undefined
      ? undefined
      : {
          DetailsInvalid: () =>
            m.booking_checkout_details_invalid({}, { locale }),
          Retryable: () =>
            retryMessage(
              shown._tag === "Retryable" ? shown.kind : "unexpected",
              locale
            ),
        }[shown._tag]();
  return (
    <View style={styles.fields}>
      <Notice tone="error" message={message} />
      {shown?._tag === "Retryable" && (
        <Button
          label={m.booking_checkout_retry({}, { locale })}
          onPress={onRetry}
          disabled={busy}
          variant="secondary"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  step: { gap: theme.spacing.lg },
  fields: { gap: theme.spacing.md },
  field: { gap: theme.spacing.xs },
  problem: { ...theme.type.caption, color: theme.colors.danger },
});
