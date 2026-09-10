"use client";

import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type InvalidEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  completeCustomerProfile,
  updateCustomerProfile,
} from "@/features/account/actions";
import type { CustomerProfileBilling } from "@/features/account/backend/customer-dotypos-adapter.service";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import { BillingScreen } from "@/features/account/components/billing/billing-screen";
import { ProfileScreen } from "@/features/account/components/profile/profile-screen";
import type { CustomerProfileInput } from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useUnsavedChanges } from "@/shared/components/unsaved-changes-guard";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

export type CustomerProfileFormMode = "complete" | "edit";

type ProfileFormProps = {
  readonly email: string;
  readonly locale: Locale;
  readonly mode: CustomerProfileFormMode;
  readonly onSectionChange?: (section: "profile" | "billing") => void;
  readonly profile?: {
    readonly firstName: string;
    readonly lastName: string | null;
    readonly phone: string | null;
    readonly billing: CustomerProfileBilling | null;
  };
  readonly section?: "profile" | "billing";
};

type BillingKind = "hidden" | "personal" | "business";

type BillingValues = {
  readonly companyName: string;
  readonly companyId: string;
  readonly vatId: string;
  readonly addressLine1: string;
  readonly addressLine2: string;
  readonly city: string;
  readonly zip: string;
  readonly country: string;
};

type SavedIdentity = {
  readonly firstName: string;
  readonly lastName: string | null;
};

type SubmittedSnapshot = {
  readonly identity: SavedIdentity;
  readonly snapshot: string;
};

const readBilling = (
  formData: FormData,
  kind: BillingKind
): CustomerProfileInput["billing"] => {
  if (kind === "business") {
    return {
      kind: "business",
      companyName: nonEmpty(formData.get("billingCompanyName")) ?? "",
      companyId: nonEmpty(formData.get("billingCompanyId")),
      vatId: nonEmpty(formData.get("billingVatId")),
      addressLine1: nonEmpty(formData.get("billingAddressLine1")),
      addressLine2: nonEmpty(formData.get("billingAddressLine2")),
      city: nonEmpty(formData.get("billingCity")),
      zip: nonEmpty(formData.get("billingZip")),
      country: nonEmpty(formData.get("billingCountry")),
    };
  }
  if (kind === "personal") {
    return {
      kind: "personal",
      addressLine1: nonEmpty(formData.get("billingAddressLine1")),
      addressLine2: nonEmpty(formData.get("billingAddressLine2")),
      city: nonEmpty(formData.get("billingCity")),
      zip: nonEmpty(formData.get("billingZip")),
      country: nonEmpty(formData.get("billingCountry")),
    };
  }
  return undefined;
};

const nonEmpty = (value: FormDataEntryValue | null) => {
  if (value instanceof File) return undefined;
  const text = value?.trim() ?? "";
  return text ? text : undefined;
};

const formSnapshot = (form: HTMLFormElement) =>
  JSON.stringify([...new FormData(form).entries()]);

export function ProfileForm({
  email,
  locale,
  mode,
  onSectionChange,
  profile,
  section = "profile",
}: ProfileFormProps) {
  const router = useRouter();
  const [billingKind, setBillingKind] = useState<BillingKind>(
    profile?.billing?.kind ?? "hidden"
  );
  const [billingValues, setBillingValues] = useState<BillingValues>(() => ({
    companyName: profile?.billing?.companyName ?? "",
    companyId: profile?.billing?.companyId ?? "",
    vatId: profile?.billing?.vatId ?? "",
    addressLine1: profile?.billing?.addressLine1 ?? "",
    addressLine2: profile?.billing?.addressLine2 ?? "",
    city: profile?.billing?.city ?? "",
    zip: profile?.billing?.zip ?? "",
    country: profile?.billing?.country ?? "",
  }));
  const [savedIdentity, setSavedIdentity] = useState<SavedIdentity>(() => ({
    firstName: profile?.firstName ?? "",
    lastName: profile?.lastName ?? null,
  }));
  const formRef = useRef<HTMLFormElement>(null);
  const baselineSnapshotRef = useRef<string | undefined>(undefined);
  const submittedSnapshotRef = useRef<SubmittedSnapshot | undefined>(undefined);
  const submittingRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [nativeFirstNameError, setNativeFirstNameError] = useState(false);
  const [hasCompletedInitialProfile, setHasCompletedInitialProfile] =
    useState(false);
  const [isRefreshPending, startRefreshTransition] = useTransition();

  const isComplete = mode === "complete";
  const isInitialCompletion = isComplete && !hasCompletedInitialProfile;
  const screenCopy = getAccountScreenCopy(locale);

  const updateBillingValue = (field: keyof BillingValues, value: string) => {
    setBillingValues((current) => ({ ...current, [field]: value }));
  };

  const action = (
    isInitialCompletion ? completeCustomerProfile : updateCustomerProfile
  ) as typeof updateCustomerProfile;

  const updateDirtyState = () => {
    const form = formRef.current;
    const baselineSnapshot = baselineSnapshotRef.current;
    if (!form || baselineSnapshot === undefined) return;
    setDirty(formSnapshot(form) !== baselineSnapshot);
  };

  const { execute, isExecuting, result } = useWorkspaceAction(action, {
    actionName: "account.profile",
    onSuccess: () => {
      const submittedSnapshot = submittedSnapshotRef.current;
      const form = formRef.current;
      const hasNoEditsSinceSubmit =
        form !== null &&
        submittedSnapshot !== undefined &&
        formSnapshot(form) === submittedSnapshot.snapshot;
      if (submittedSnapshot !== undefined) {
        baselineSnapshotRef.current = submittedSnapshot.snapshot;
        setSavedIdentity(submittedSnapshot.identity);
        updateDirtyState();
      }
      if (isInitialCompletion) {
        setHasCompletedInitialProfile(true);
      }
      if (isComplete && hasNoEditsSinceSubmit) {
        startRefreshTransition(() => router.refresh());
      }
    },
    onError: ({ error }) => {
      const fieldErrors = error.validationErrors?.fieldErrors;
      let sectionWithError: "profile" | "billing" | undefined;
      if (
        (fieldErrors?.firstName?.length ?? 0) > 0 ||
        (fieldErrors?.phone?.length ?? 0) > 0
      ) {
        sectionWithError = "profile";
      } else if ((fieldErrors?.billing?.length ?? 0) > 0) {
        sectionWithError = "billing";
      }
      if (!isComplete && sectionWithError !== undefined) {
        onSectionChange?.(sectionWithError);
      }
    },
  });

  useUnsavedChanges({
    enabled: !isRefreshPending,
    isDirty: () => {
      const form = formRef.current;
      const baselineSnapshot = baselineSnapshotRef.current;
      if (!form || baselineSnapshot === undefined) return dirty;
      return formSnapshot(form) !== baselineSnapshot;
    },
    message: m.accountProfileUnsavedChanges({}, { locale }),
  });

  useEffect(() => {
    if (!isExecuting) submittingRef.current = false;
  }, [isExecuting]);

  useEffect(() => {
    const form = formRef.current;
    if (!form || baselineSnapshotRef.current !== undefined) return;
    baselineSnapshotRef.current = formSnapshot(form);
  }, []);

  useEffect(() => {
    const form = formRef.current;
    const baselineSnapshot = baselineSnapshotRef.current;
    const billingSelect = form?.querySelector<HTMLSelectElement>(
      "#account-profile-billing-kind"
    );
    if (
      !form ||
      baselineSnapshot === undefined ||
      billingSelect?.value !== billingKind
    ) {
      return;
    }
    setDirty(formSnapshot(form) !== baselineSnapshot);
  }, [billingKind]);

  const submit = (formData: FormData) => {
    const input: CustomerProfileInput = {
      firstName: String(formData.get("firstName") ?? "").trim(),
      lastName: nonEmpty(formData.get("lastName")),
      phone: nonEmpty(formData.get("phone")),
      billing: readBilling(formData, billingKind),
    };
    execute(input);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isExecuting || submittingRef.current) return;
    const form = event.currentTarget;
    if (!form.checkValidity()) return;
    submittingRef.current = true;
    const formData = new FormData(form);
    submittedSnapshotRef.current = {
      identity: {
        firstName: String(formData.get("firstName") ?? "").trim(),
        lastName: nonEmpty(formData.get("lastName")) ?? null,
      },
      snapshot: formSnapshot(form),
    };
    submit(formData);
  };

  const handleInvalidCapture = (event: InvalidEvent<HTMLFormElement>) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.getAttribute("name") === null
    ) {
      return;
    }

    const fieldName = target.getAttribute("name");

    if (fieldName === "firstName") {
      setNativeFirstNameError(true);
    }

    const invalidInputs = Array.from(event.currentTarget.elements).filter(
      (element): element is HTMLInputElement =>
        element instanceof HTMLInputElement && !element.validity.valid
    );
    const firstInvalidFieldName =
      invalidInputs.find(({ name }) => name === "firstName" || name === "phone")
        ?.name ??
      invalidInputs.find(({ name }) => name.startsWith("billing"))?.name;
    let firstInvalidSection: "profile" | "billing" | undefined;
    if (
      firstInvalidFieldName === "firstName" ||
      firstInvalidFieldName === "phone"
    ) {
      firstInvalidSection = "profile";
    } else if (firstInvalidFieldName?.startsWith("billing")) {
      firstInvalidSection = "billing";
    }

    if (
      !isComplete &&
      firstInvalidSection !== undefined &&
      section !== firstInvalidSection
    ) {
      onSectionChange?.(firstInvalidSection);
    }
  };

  const handleInput = (event: FormEvent<HTMLFormElement>) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      target.name === "firstName" &&
      target.validity.valid
    ) {
      setNativeFirstNameError(false);
    }
    updateDirtyState();
  };

  const submitLabel = isComplete
    ? m.accountCompletionSubmit({}, { locale })
    : m.accountProfileSave({}, { locale });
  const validationErrors = result.validationErrors;
  const hasValidationErrors = Boolean(
    validationErrors && Object.keys(validationErrors).length > 0
  );

  const identityFields = (
    <IdentityFields
      firstNameError={
        Boolean(validationErrors?.fieldErrors?.firstName?.length) ||
        nativeFirstNameError
      }
      lastName={profile?.lastName}
      locale={locale}
      phone={profile?.phone}
      phoneError={Boolean(validationErrors?.fieldErrors?.phone?.length)}
      firstName={profile?.firstName}
    />
  );
  const billingFields = (
    <BillingFields
      billingKind={billingKind}
      billingValues={billingValues}
      locale={locale}
      onBillingKindChange={setBillingKind}
      onBillingValueChange={updateBillingValue}
      billingErrors={validationErrors?.fieldErrors?.billing}
    />
  );
  const formFooter = (
    <>
      <div
        id="account-profile-feedback"
        aria-live="polite"
        className="min-h-5 text-sm"
      >
        {result.data ? (
          <p className="text-emerald-800">
            {isComplete
              ? m.accountCompletionSaved({}, { locale })
              : m.accountProfileSaved({}, { locale })}
          </p>
        ) : null}
        {result.serverError ? (
          <p className="text-red-700">{result.serverError}</p>
        ) : null}
        {hasValidationErrors && !result.serverError ? (
          <p className="text-red-700">
            {m.accountProfileValidationError({}, { locale })}
          </p>
        ) : null}
      </div>

      <Button
        className={
          isComplete
            ? undefined
            : {
                billing:
                  "rounded-xl bg-navy-blue px-4 text-xs uppercase tracking-[0.08em] hover:bg-navy-blue/90",
                profile:
                  "rounded-xl bg-burned-orange px-4 text-xs uppercase tracking-[0.08em] hover:bg-burned-orange/90",
              }[section]
        }
        id="account-profile-submit"
        size={isComplete ? "default" : "sm"}
        type="submit"
        disabled={isExecuting || isRefreshPending}
      >
        {isExecuting ? m.accountProfileSaving({}, { locale }) : submitLabel}
      </Button>
    </>
  );

  return (
    <form
      id="account-profile-form"
      aria-describedby="account-profile-feedback"
      aria-busy={isRefreshPending}
      ref={formRef}
      onInvalidCapture={handleInvalidCapture}
      onSubmit={handleSubmit}
      onChange={updateDirtyState}
      onInput={handleInput}
    >
      <fieldset
        className={isComplete ? "space-y-6" : undefined}
        disabled={isRefreshPending}
      >
        {isComplete ? (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              {identityFields}
              <div className="space-y-2">
                <Label htmlFor="account-profile-email">
                  {m.accountProfileEmailLabel({}, { locale })}
                </Label>
                <Input
                  id="account-profile-email"
                  value={email}
                  type="email"
                  autoComplete="email"
                  readOnly
                  aria-readonly="true"
                  className="bg-navy-blue/3 text-navy-blue/70"
                />
              </div>
            </div>

            <details className="rounded-2xl border border-navy-blue/12 p-4">
              <summary className="cursor-pointer text-sm font-bold text-navy-blue">
                {m.accountProfileBillingSummary({}, { locale })}
              </summary>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                {billingFields}
              </div>
            </details>

            {formFooter}
          </>
        ) : (
          <>
            <div hidden={section !== "profile"}>
              <ProfileScreen
                copy={screenCopy.profile}
                email={email}
                firstName={savedIdentity.firstName}
                footer={section === "profile" ? formFooter : undefined}
                lastName={savedIdentity.lastName}
                locale={locale}
              >
                {identityFields}
              </ProfileScreen>
            </div>
            <div hidden={section !== "billing"}>
              <BillingScreen
                copy={screenCopy.billing}
                footer={section === "billing" ? formFooter : undefined}
                locale={locale}
              >
                <div className="grid gap-5 sm:grid-cols-2">{billingFields}</div>
              </BillingScreen>
            </div>
          </>
        )}
      </fieldset>
    </form>
  );
}

function IdentityFields({
  firstName,
  firstNameError,
  lastName,
  locale,
  phone,
  phoneError,
}: {
  readonly firstName?: string;
  readonly firstNameError: boolean;
  readonly lastName?: string | null;
  readonly locale: Locale;
  readonly phone?: string | null;
  readonly phoneError: boolean;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="account-profile-first-name">
          {m.accountProfileFirstNameLabel({}, { locale })}
        </Label>
        <Input
          id="account-profile-first-name"
          name="firstName"
          defaultValue={firstName}
          required
          maxLength={100}
          autoComplete="given-name"
          aria-invalid={firstNameError}
          aria-describedby={
            firstNameError ? "account-profile-first-name-error" : undefined
          }
        />
        {firstNameError ? (
          <p
            id="account-profile-first-name-error"
            className="text-sm text-red-700"
          >
            {m.accountProfileFirstNameRequired({}, { locale })}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="account-profile-last-name">
          {m.accountProfileLastNameLabel({}, { locale })}
        </Label>
        <Input
          id="account-profile-last-name"
          name="lastName"
          defaultValue={lastName ?? undefined}
          maxLength={100}
          autoComplete="family-name"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="account-profile-phone">
          {m.accountProfilePhoneLabel({}, { locale })}
        </Label>
        <Input
          id="account-profile-phone"
          name="phone"
          type="tel"
          defaultValue={phone ?? undefined}
          maxLength={32}
          autoComplete="tel"
          aria-invalid={phoneError}
          aria-describedby={
            phoneError ? "account-profile-phone-error" : undefined
          }
        />
        {phoneError ? (
          <p id="account-profile-phone-error" className="text-sm text-red-700">
            {m.accountProfilePhoneInvalid({}, { locale })}
          </p>
        ) : null}
      </div>
    </>
  );
}

function BillingFields({
  billingErrors,
  billingKind,
  billingValues,
  locale,
  onBillingKindChange,
  onBillingValueChange,
}: {
  readonly billingErrors?: readonly string[];
  readonly billingKind: BillingKind;
  readonly billingValues: BillingValues;
  readonly locale: Locale;
  readonly onBillingKindChange: (kind: BillingKind) => void;
  readonly onBillingValueChange: (
    field: keyof BillingValues,
    value: string
  ) => void;
}) {
  const billingFieldNames = [
    "companyName",
    "companyId",
    "vatId",
    "addressLine1",
    "addressLine2",
    "city",
    "zip",
    "country",
  ] as const satisfies readonly (keyof BillingValues)[];
  const hasBillingFieldError = (error: string) =>
    billingFieldNames.some(
      (field) => error === field || error.startsWith(`${field}:`)
    );
  const genericBillingError =
    billingErrors?.some((error) => !hasBillingFieldError(error)) === true;
  const getBillingFieldErrors = (field: keyof BillingValues) =>
    (billingErrors ?? []).flatMap((error) => {
      if (error === field) return [error];
      const prefix = `${field}:`;
      if (!error.startsWith(prefix)) return [];
      const message = error.slice(prefix.length).trim();
      return message ? [message] : [];
    });
  const billingFieldErrorId = (field: keyof BillingValues) =>
    `account-profile-billing-${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-error`;
  const hasFieldError = (field: keyof BillingValues) =>
    getBillingFieldErrors(field).length > 0;
  const renderFieldError = (field: keyof BillingValues) => {
    const errors = getBillingFieldErrors(field);
    if (errors.length === 0) return null;
    return (
      <p id={billingFieldErrorId(field)} className="text-sm text-red-700">
        {m.accountProfileValidationError({}, { locale })}
      </p>
    );
  };

  return (
    <>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="account-profile-billing-kind">
          {m.accountProfileBillingKindLabel({}, { locale })}
        </Label>
        <select
          id="account-profile-billing-kind"
          value={billingKind}
          aria-invalid={genericBillingError}
          aria-describedby={
            genericBillingError ? "account-profile-billing-error" : undefined
          }
          onChange={(event) =>
            onBillingKindChange(event.target.value as BillingKind)
          }
          className="w-full rounded-xl border border-navy-blue/14 bg-white px-3 py-2.5 text-navy-blue"
        >
          <option value="hidden">
            {m.accountProfileBillingNone({}, { locale })}
          </option>
          <option value="personal">
            {m.accountProfileBillingPersonal({}, { locale })}
          </option>
          <option value="business">
            {m.accountProfileBillingBusiness({}, { locale })}
          </option>
        </select>
        {genericBillingError ? (
          <p
            id="account-profile-billing-error"
            className="text-sm text-red-700"
          >
            {m.accountProfileValidationError({}, { locale })}
          </p>
        ) : null}
      </div>
      {billingKind !== "hidden" ? (
        <>
          {billingKind === "business" ? (
            <>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="account-profile-billing-company-name">
                  {m.accountProfileCompanyNameLabel({}, { locale })}
                </Label>
                <Input
                  id="account-profile-billing-company-name"
                  name="billingCompanyName"
                  value={billingValues.companyName}
                  onInput={(event) =>
                    onBillingValueChange(
                      "companyName",
                      event.currentTarget.value
                    )
                  }
                  required={billingKind === "business"}
                  aria-invalid={hasFieldError("companyName")}
                  aria-describedby={
                    hasFieldError("companyName")
                      ? billingFieldErrorId("companyName")
                      : undefined
                  }
                  maxLength={200}
                />
                {renderFieldError("companyName")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-profile-billing-company-id">
                  {m.accountProfileCompanyIdLabel({}, { locale })}
                </Label>
                <Input
                  id="account-profile-billing-company-id"
                  name="billingCompanyId"
                  value={billingValues.companyId}
                  onInput={(event) =>
                    onBillingValueChange("companyId", event.currentTarget.value)
                  }
                  aria-invalid={hasFieldError("companyId")}
                  aria-describedby={
                    hasFieldError("companyId")
                      ? billingFieldErrorId("companyId")
                      : undefined
                  }
                  maxLength={32}
                />
                {renderFieldError("companyId")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-profile-billing-vat-id">
                  {m.accountProfileVatIdLabel({}, { locale })}
                </Label>
                <Input
                  id="account-profile-billing-vat-id"
                  name="billingVatId"
                  value={billingValues.vatId}
                  onInput={(event) =>
                    onBillingValueChange("vatId", event.currentTarget.value)
                  }
                  aria-invalid={hasFieldError("vatId")}
                  aria-describedby={
                    hasFieldError("vatId")
                      ? billingFieldErrorId("vatId")
                      : undefined
                  }
                  maxLength={32}
                />
                {renderFieldError("vatId")}
              </div>
            </>
          ) : null}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="account-profile-billing-address-line1">
              {m.accountProfileAddressLine1Label({}, { locale })}
            </Label>
            <Input
              id="account-profile-billing-address-line1"
              name="billingAddressLine1"
              value={billingValues.addressLine1}
              onInput={(event) =>
                onBillingValueChange("addressLine1", event.currentTarget.value)
              }
              aria-invalid={hasFieldError("addressLine1")}
              aria-describedby={
                hasFieldError("addressLine1")
                  ? billingFieldErrorId("addressLine1")
                  : undefined
              }
              maxLength={200}
            />
            {renderFieldError("addressLine1")}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="account-profile-billing-address-line2">
              {m.accountProfileAddressLine2Label({}, { locale })}
            </Label>
            <Input
              id="account-profile-billing-address-line2"
              name="billingAddressLine2"
              value={billingValues.addressLine2}
              onInput={(event) =>
                onBillingValueChange("addressLine2", event.currentTarget.value)
              }
              aria-invalid={hasFieldError("addressLine2")}
              aria-describedby={
                hasFieldError("addressLine2")
                  ? billingFieldErrorId("addressLine2")
                  : undefined
              }
              maxLength={200}
            />
            {renderFieldError("addressLine2")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-profile-billing-city">
              {m.accountProfileCityLabel({}, { locale })}
            </Label>
            <Input
              id="account-profile-billing-city"
              name="billingCity"
              value={billingValues.city}
              onInput={(event) =>
                onBillingValueChange("city", event.currentTarget.value)
              }
              aria-invalid={hasFieldError("city")}
              aria-describedby={
                hasFieldError("city") ? billingFieldErrorId("city") : undefined
              }
              maxLength={100}
            />
            {renderFieldError("city")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-profile-billing-zip">
              {m.accountProfileZipLabel({}, { locale })}
            </Label>
            <Input
              id="account-profile-billing-zip"
              name="billingZip"
              value={billingValues.zip}
              onInput={(event) =>
                onBillingValueChange("zip", event.currentTarget.value)
              }
              aria-invalid={hasFieldError("zip")}
              aria-describedby={
                hasFieldError("zip") ? billingFieldErrorId("zip") : undefined
              }
              maxLength={20}
            />
            {renderFieldError("zip")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-profile-billing-country">
              {m.accountProfileCountryLabel({}, { locale })}
            </Label>
            <Input
              id="account-profile-billing-country"
              name="billingCountry"
              value={billingValues.country}
              onInput={(event) =>
                onBillingValueChange("country", event.currentTarget.value)
              }
              aria-invalid={hasFieldError("country")}
              aria-describedby={
                hasFieldError("country")
                  ? billingFieldErrorId("country")
                  : undefined
              }
              maxLength={2}
              autoComplete="country"
            />
            {renderFieldError("country")}
          </div>
        </>
      ) : null}
    </>
  );
}
