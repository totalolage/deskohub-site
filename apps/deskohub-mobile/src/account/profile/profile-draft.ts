import {
  type CustomerProfile,
  CustomerProfileCompletionInput,
  CustomerProfileInput,
  customerInputParseOptions,
} from "@deskohub/workspace-customer-api";
import { Option, Result, SchemaIssue, SchemaParser } from "effect";

/** Which billing details the customer keeps: none, personal or business. */
export type BillingChoice = "none" | "personal" | "business";

/**
 * The profile as the form edits it: every field as entered text. Profile and
 * Billing edit this one draft, and both save it whole, because the Workspace
 * clears every field a save leaves out.
 */
export interface ProfileDraft {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
  readonly billingKind: BillingChoice;
  readonly companyName: string;
  readonly companyId: string;
  readonly vatId: string;
  readonly addressLine1: string;
  readonly addressLine2: string;
  readonly city: string;
  readonly zip: string;
  readonly country: string;
}

/** First-time completion also takes the code the customer was invited with. */
export interface CompletionDraft extends ProfileDraft {
  readonly referralCode: string;
}

export type ProfileTextField = Exclude<keyof ProfileDraft, "billingKind">;
export type CompletionTextField = ProfileTextField | "referralCode";

/** The fields the Profile screen shows, in screen order. */
export const identityFields = [
  "firstName",
  "lastName",
  "phone",
] as const satisfies ReadonlyArray<ProfileTextField>;

const addressFields = [
  "addressLine1",
  "addressLine2",
  "city",
  "zip",
  "country",
] as const satisfies ReadonlyArray<ProfileTextField>;

const businessFields = [
  "companyName",
  "companyId",
  "vatId",
] as const satisfies ReadonlyArray<ProfileTextField>;

/** The billing fields a billing choice shows, in screen order. */
export const billingFieldsOf = (
  kind: BillingChoice
): ReadonlyArray<ProfileTextField> =>
  ({
    none: [],
    personal: addressFields,
    business: [...businessFields, ...addressFields],
  })[kind];

/** Every text field of the profile, in the order the screens show them. */
export const profileFieldOrder: ReadonlyArray<ProfileTextField> = [
  ...identityFields,
  ...businessFields,
  ...addressFields,
];

/** Completion's single form: identity, referral code, then billing. */
export const completionFieldOrder: ReadonlyArray<CompletionTextField> = [
  ...identityFields,
  "referralCode",
  ...businessFields,
  ...addressFields,
];

export const emptyProfileDraft: ProfileDraft = {
  firstName: "",
  lastName: "",
  phone: "",
  billingKind: "none",
  companyName: "",
  companyId: "",
  vatId: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  zip: "",
  country: "",
};

/** The draft of a stored profile: what the customer has saved now. */
export const profileDraftOf = (profile: CustomerProfile): ProfileDraft => ({
  firstName: profile.firstName,
  lastName: profile.lastName ?? "",
  phone: profile.phone ?? "",
  billingKind: profile.billing?.kind ?? "none",
  companyName: profile.billing?.companyName ?? "",
  companyId: profile.billing?.companyId ?? "",
  vatId: profile.billing?.vatId ?? "",
  addressLine1: profile.billing?.addressLine1 ?? "",
  addressLine2: profile.billing?.addressLine2 ?? "",
  city: profile.billing?.city ?? "",
  zip: profile.billing?.zip ?? "",
  country: profile.billing?.country ?? "",
});

/** A new customer's completion draft, prefilled with their invitation code. */
export const completionDraftOf = (
  invitationCode: string | undefined
): CompletionDraft => ({
  ...emptyProfileDraft,
  referralCode: invitationCode ?? "",
});

/** Whether two drafts hold the same values. */
export const sameDraft = <D extends ProfileDraft>(left: D, right: D) =>
  (Object.keys(left) as Array<keyof D>).every(
    (field) => left[field] === right[field]
  );

/** Why a field's value can't be saved; the screen picks the copy. */
export type ProfileFieldProblem = "required" | "invalid-phone" | "invalid";

export interface ProfileDraftInvalid<F extends string> {
  /** The problem of each invalid field. */
  readonly fields: Partial<Record<F, ProfileFieldProblem>>;
  /** The first invalid field in screen order, to focus. */
  readonly first: Option.Option<F>;
}

// Optional text the customer left blank is left out: the Workspace then
// clears the stored value, which is what an emptied field means.
const entered = (value: string) =>
  value.trim() === "" ? undefined : value;

const billingInputOf = (draft: ProfileDraft) =>
  ({
    none: undefined,
    personal: {
      kind: "personal",
      addressLine1: entered(draft.addressLine1),
      addressLine2: entered(draft.addressLine2),
      city: entered(draft.city),
      zip: entered(draft.zip),
      country: entered(draft.country),
    },
    business: {
      kind: "business",
      companyName: draft.companyName,
      companyId: entered(draft.companyId),
      vatId: entered(draft.vatId),
      addressLine1: entered(draft.addressLine1),
      addressLine2: entered(draft.addressLine2),
      city: entered(draft.city),
      zip: entered(draft.zip),
      country: entered(draft.country),
    },
  })[draft.billingKind];

// The complete profile a save sends, before the contract decodes it. Blank
// optional text and "no billing details" are sent as left out.
const profileInputOf = (draft: ProfileDraft) => ({
  firstName: draft.firstName,
  lastName: entered(draft.lastName),
  phone: entered(draft.phone),
  billing: billingInputOf(draft),
});

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

// Billing fields sit under `billing` in the contract and flat in the draft.
const fieldOfPath = <F extends string>(
  path: ReadonlyArray<unknown>,
  fields: ReadonlyArray<F>
): Option.Option<F> => {
  const key = path[0] === "billing" ? path[1] : path[0];
  return Option.liftPredicate(key, (candidate): candidate is F =>
    fields.includes(candidate as F)
  );
};

const problemOf = (
  field: string,
  value: string
): ProfileFieldProblem => {
  if (field === "phone") return "invalid-phone";
  return value.trim() === "" ? "required" : "invalid";
};

const invalidDraft = <F extends CompletionTextField>({
  issue,
  draft,
  order,
}: {
  readonly issue: SchemaIssue.Issue;
  readonly draft: Record<F, string>;
  readonly order: ReadonlyArray<F>;
}): ProfileDraftInvalid<F> => {
  const fields: Partial<Record<F, ProfileFieldProblem>> = {};
  for (const { path } of formatIssues(issue).issues) {
    const field = fieldOfPath(path ?? [], order);
    if (Option.isSome(field) && fields[field.value] === undefined)
      fields[field.value] = problemOf(field.value, draft[field.value]);
  }
  return {
    fields,
    first: Option.fromNullishOr(
      order.find((field) => fields[field] !== undefined)
    ),
  };
};

const decodeProfileInput = SchemaParser.decodeUnknownResult(
  CustomerProfileInput,
  customerInputParseOptions
);

const decodeCompletionInput = SchemaParser.decodeUnknownResult(
  CustomerProfileCompletionInput,
  customerInputParseOptions
);

/**
 * The profile a save submits, validated by the contract's own schema (trimmed
 * and length-checked, phone normalizable or blank), or the fields to fix.
 */
export const validateProfileDraft = (
  draft: ProfileDraft
): Result.Result<CustomerProfileInput, ProfileDraftInvalid<ProfileTextField>> =>
  Result.mapError(decodeProfileInput(profileInputOf(draft)), (issue) =>
    invalidDraft({ issue, draft, order: profileFieldOrder })
  );

/**
 * The completion a submit sends: the complete profile plus the referral code,
 * telling the Workspace which code came prefilled from the invitation.
 */
export const validateCompletionDraft = (
  draft: CompletionDraft,
  invitationCode: string | undefined
): Result.Result<
  CustomerProfileCompletionInput,
  ProfileDraftInvalid<CompletionTextField>
> =>
  Result.mapError(
    decodeCompletionInput({
      ...profileInputOf(draft),
      referralCode: entered(draft.referralCode),
      prefilledReferralCode: invitationCode,
    }),
    (issue) => invalidDraft({ issue, draft, order: completionFieldOrder })
  );
