import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import type { CheckoutDetails } from "../checkout/checkout-state";

/**
 * The details step's form, as the site's contact and billing step asks it
 * (apps/deskohub-workspace/features/reservation/components/
 * reservation-customer-fields.tsx, reservation-billing-fields.tsx).
 */

/** Who the signed-in account books as when it books for itself. */
export interface SelfContact {
  readonly email: string;
  /** The saved profile's name; none asks for it (no linked profile yet). */
  readonly name: Option.Option<string>;
  /** The saved phone when it's valid; none asks for one inline. */
  readonly phone: Option.Option<string>;
}

/**
 * Whether the account can fill in the details step:
 * - `Ready`: a linked profile books as itself, or an account without one
 *   enters its name and phone (the booking completes its profile).
 * - `Unavailable`: the account can't book until support or deletion is
 *   resolved, or its state couldn't be read.
 */
export type DetailsAccess =
  | { readonly _tag: "Ready"; readonly self: SelfContact }
  | {
      readonly _tag: "Unavailable";
      readonly reason:
        | "support-required"
        | "deletion-pending"
        | "authenticated-unavailable";
    };

const nonBlank = (value: string | null | undefined): Option.Option<string> =>
  Option.fromNullishOr(value).pipe(
    Option.map((text) => text.trim()),
    Option.filter((text) => text !== "")
  );

/** The site shows the saved phone only when it's valid, else asks inline. */
const savedPhone = (phone: string | null) =>
  nonBlank(phone).pipe(Option.filter(isPhoneNumber));

export const detailsAccess = (account: CustomerAccountState): DetailsAccess => {
  switch (account.kind) {
    case "linked": {
      const { firstName, lastName } = account.profile;
      const name = [nonBlank(firstName), nonBlank(lastName)]
        .flatMap((part) => (Option.isSome(part) ? [part.value] : []))
        .join(" ");
      return {
        _tag: "Ready",
        self: {
          email: account.email,
          name: nonBlank(name),
          phone: savedPhone(account.profile.phone),
        },
      };
    }
    case "completion-required":
    case "review-account":
      return {
        _tag: "Ready",
        self: {
          email: account.email,
          name: Option.none(),
          phone: Option.none(),
        },
      };
    case "support-required":
    case "deletion-pending":
    case "authenticated-unavailable":
      return { _tag: "Unavailable", reason: account.kind };
  }
};

/**
 * The contact to book as once the server rejected a saved name or phone:
 * that field is asked for inline, as a missing one is, so the customer can
 * correct it (the app's checks are looser than the server's).
 */
export const withRejectedSavedFields = (
  self: SelfContact,
  rejected: ReadonlySet<"name" | "phone">
): SelfContact => ({
  ...self,
  name: rejected.has("name") ? Option.none() : self.name,
  phone: rejected.has("phone") ? Option.none() : self.phone,
});

/** What the invoice needs: none, a personal invoice, or a business one. */
export type BillingChoice = "none" | "personal-invoice" | "business";

export interface AddressDraft {
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface DetailsDraft {
  readonly bookingFor: CheckoutDetails["bookingFor"];
  /** What the account enters about itself when the profile lacks it. */
  readonly self: { readonly name: string; readonly phone: string };
  /** Kept while the customer switches back to booking for themselves. */
  readonly someoneElse: {
    readonly name: string;
    readonly email: string;
    readonly emailRepeat: string;
    readonly phone: string;
  };
  readonly billing: BillingChoice;
  /** The invoice address, for a personal invoice or the business buyer. */
  readonly address: AddressDraft;
  readonly buyer: {
    readonly legalName: string;
    readonly companyId: string;
    readonly vatId: string;
  };
  /** Self only; unticked records nothing and withdraws nothing. */
  readonly marketingConsent: boolean;
}

/** The site's billing step starts on no invoice, with the country CZ. */
export const emptyDetailsDraft: DetailsDraft = {
  bookingFor: "self",
  self: { name: "", phone: "" },
  someoneElse: { name: "", email: "", emailRepeat: "", phone: "" },
  billing: "none",
  address: { line1: "", line2: "", city: "", postalCode: "", country: "CZ" },
  buyer: { legalName: "", companyId: "", vatId: "" },
  marketingConsent: false,
};

/** A form field, named as the details step shows it. */
export type DetailsField =
  | "name"
  | "email"
  | "emailRepeat"
  | "phone"
  | "address.line1"
  | "address.line2"
  | "address.city"
  | "address.postalCode"
  | "address.country"
  | "buyer.legalName"
  | "buyer.companyId"
  | "buyer.vatId";

/**
 * - `invalid`: the server rejected the field without saying why.
 */
export type FieldProblem =
  | "required"
  | "too_short"
  | "too_long"
  | "invalid_email"
  | "emails_differ"
  | "invalid_phone"
  | "invalid_country"
  | "invalid";

export type DetailsFieldProblems = Partial<Record<DetailsField, FieldProblem>>;

export type DetailsValidation =
  | { readonly _tag: "Valid"; readonly details: CheckoutDetails }
  | { readonly _tag: "Invalid"; readonly problems: DetailsFieldProblems };

/** Lengths as the site's contact schema and the API contract cap them. */
const limits = {
  nameMin: 2,
  name: 100,
  email: 255,
  phone: 20,
  line: 180,
  city: 255,
  postalCode: 20,
  legalName: 180,
  /** The API caps company and VAT ids below the site form's 255. */
  companyId: 64,
} as const;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A loose phone check: the site validates with libphonenumber for CZ, which
 * the app doesn't ship; the server's check stays authoritative and answers
 * `contact.phone` when it disagrees.
 */
export function isPhoneNumber(phone: string): boolean {
  const digits = phone.replace(/[\s().-]/g, "");
  return /^\+?\d{9,15}$/.test(digits);
}

type Check = (value: string) => FieldProblem | undefined;

const required: Check = (value) => (value === "" ? "required" : undefined);
const maxLength =
  (maximum: number): Check =>
  (value) =>
    value.length > maximum ? "too_long" : undefined;
const minLength =
  (minimum: number): Check =>
  (value) =>
    value.length < minimum ? "too_short" : undefined;
const email: Check = (value) =>
  emailPattern.test(value) ? undefined : "invalid_email";
const phone: Check = (value) =>
  isPhoneNumber(value) ? undefined : "invalid_phone";
const country: Check = (value) =>
  /^[A-Z]{2}$/.test(value) ? undefined : "invalid_country";

const firstProblem = (value: string, checks: ReadonlyArray<Check>) =>
  checks.reduce<FieldProblem | undefined>(
    (found, check) => found ?? check(value),
    undefined
  );

const nameChecks = [
  required,
  minLength(limits.nameMin),
  maxLength(limits.name),
];
const emailChecks = [required, maxLength(limits.email), email];
const phoneChecks = [required, maxLength(limits.phone), phone];

const trimAll = <Fields extends { readonly [Key in keyof Fields]: string }>(
  fields: Fields
) =>
  Object.fromEntries(
    Object.entries<string>(fields).map(([key, value]) => [key, value.trim()])
  ) as { readonly [Key in keyof Fields]: string };

const sameEmail = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

interface ContactInput {
  readonly contact: CheckoutDetails["contact"];
  readonly problems: DetailsFieldProblems;
}

const selfContactInput = (
  self: SelfContact,
  draft: DetailsDraft
): ContactInput => {
  const entered = trimAll(draft.self);
  const name = Option.getOrElse(self.name, () => entered.name);
  const phoneNumber = Option.getOrElse(self.phone, () => entered.phone);
  return {
    contact: { name, email: self.email, phone: phoneNumber },
    problems: {
      ...(Option.isNone(self.name) && { name: firstProblem(name, nameChecks) }),
      ...(Option.isNone(self.phone) && {
        phone: firstProblem(phoneNumber, phoneChecks),
      }),
    },
  };
};

const someoneElseInput = (draft: DetailsDraft): ContactInput => {
  const entered = trimAll(draft.someoneElse);
  return {
    contact: { name: entered.name, email: entered.email, phone: entered.phone },
    problems: {
      name: firstProblem(entered.name, nameChecks),
      email: firstProblem(entered.email, emailChecks),
      emailRepeat:
        firstProblem(entered.emailRepeat, [required]) ??
        (sameEmail(entered.email, entered.emailRepeat)
          ? undefined
          : "emails_differ"),
      phone: firstProblem(entered.phone, phoneChecks),
    },
  };
};

interface BillingInput {
  readonly billing: CheckoutDetails["billing"];
  readonly problems: DetailsFieldProblems;
}

const addressInput = (draft: AddressDraft) => {
  const entered = trimAll(draft);
  const address = {
    line1: entered.line1,
    ...(entered.line2 !== "" && { line2: entered.line2 }),
    city: entered.city,
    postalCode: entered.postalCode,
    country: entered.country.toUpperCase(),
  };
  return {
    address,
    problems: {
      "address.line1": firstProblem(address.line1, [
        required,
        maxLength(limits.line),
      ]),
      "address.line2": firstProblem(entered.line2, [maxLength(limits.line)]),
      "address.city": firstProblem(address.city, [
        required,
        maxLength(limits.city),
      ]),
      "address.postalCode": firstProblem(address.postalCode, [
        required,
        maxLength(limits.postalCode),
      ]),
      "address.country": firstProblem(address.country, [required, country]),
    } satisfies DetailsFieldProblems,
  };
};

const billingInput = (draft: DetailsDraft): BillingInput => {
  switch (draft.billing) {
    case "none":
      return {
        billing: { purpose: "personal", invoice: "none" },
        problems: {},
      };
    case "personal-invoice": {
      const { address, problems } = addressInput(draft.address);
      return {
        billing: { purpose: "personal", invoice: "requested", address },
        problems,
      };
    }
    case "business": {
      const { address, problems } = addressInput(draft.address);
      const buyer = trimAll(draft.buyer);
      return {
        billing: {
          purpose: "business",
          invoice: "required",
          buyer: {
            kind: "business",
            legalName: buyer.legalName,
            companyId: buyer.companyId,
            ...(buyer.vatId !== "" && { vatId: buyer.vatId }),
            address,
          },
        },
        problems: {
          ...problems,
          "buyer.legalName": firstProblem(buyer.legalName, [
            required,
            maxLength(limits.legalName),
          ]),
          "buyer.companyId": firstProblem(buyer.companyId, [
            required,
            maxLength(limits.companyId),
          ]),
          "buyer.vatId": firstProblem(buyer.vatId, [
            maxLength(limits.companyId),
          ]),
        },
      };
    }
  }
};

const presentProblems = (
  problems: DetailsFieldProblems
): DetailsFieldProblems =>
  Object.fromEntries(
    Object.entries(problems).filter(([, problem]) => problem !== undefined)
  );

/**
 * Checks the form as the site does and builds what create checkout sends.
 * Marketing consent is asked only when booking for oneself and sent only
 * when ticked.
 */
export function validateDetails(
  self: SelfContact,
  draft: DetailsDraft
): DetailsValidation {
  const contactInput =
    draft.bookingFor === "self"
      ? selfContactInput(self, draft)
      : someoneElseInput(draft);
  const { billing, problems: billingProblems } = billingInput(draft);
  const problems = presentProblems({
    ...contactInput.problems,
    ...billingProblems,
  });
  if (Object.keys(problems).length > 0) {
    return { _tag: "Invalid", problems };
  }
  return {
    _tag: "Valid",
    details: {
      bookingFor: draft.bookingFor,
      contact: contactInput.contact,
      billing,
      ...(draft.bookingFor === "self" &&
        draft.marketingConsent && { marketingConsent: true }),
    },
  };
}

const serverFields: ReadonlyMap<string, DetailsField> = new Map([
  ["contact.name", "name"],
  ["contact.email", "email"],
  ["contact.phone", "phone"],
  ["billing.address.line1", "address.line1"],
  ["billing.address.line2", "address.line2"],
  ["billing.address.city", "address.city"],
  ["billing.address.postalCode", "address.postalCode"],
  ["billing.address.country", "address.country"],
  ["billing.buyer.legalName", "buyer.legalName"],
  ["billing.buyer.companyId", "buyer.companyId"],
  ["billing.buyer.vatId", "buyer.vatId"],
  ["billing.buyer.address.line1", "address.line1"],
  ["billing.buyer.address.line2", "address.line2"],
  ["billing.buyer.address.city", "address.city"],
  ["billing.buyer.address.postalCode", "address.postalCode"],
  ["billing.buyer.address.country", "address.country"],
]);

/**
 * The form field a server `CustomerCheckoutDetailsInvalid.field` names;
 * none for a field the form doesn't show (such as plain `billing`).
 */
export const detailsFieldOf = (
  serverField: Option.Option<string>
): Option.Option<DetailsField> =>
  serverField.pipe(
    Option.flatMap((field) => Option.fromUndefinedOr(serverFields.get(field)))
  );
