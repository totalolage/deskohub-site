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
import { type FieldErrors, useForm, useWatch } from "react-hook-form";
import {
  type AresBusinessLookupResult,
  completeCustomerProfile,
  lookupAresBusiness,
  updateCustomerProfile,
} from "@/features/account/actions";
import type { AresBusinessBillingDraft } from "@/features/account/backend/ares-business-draft";
import type { CustomerProfileBilling } from "@/features/account/backend/customer-dotypos-adapter.service";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import { BillingScreen } from "@/features/account/components/billing/billing-screen";
import { AvatarControl } from "@/features/account/components/profile/avatar-control";
import { ProfileScreen } from "@/features/account/components/profile/profile-screen";
import {
  createProfileFormResolver,
  getProfileFormDefaultValues,
  type ProfileBillingKind,
  type ProfileFormValues,
  profileBillingFieldNames,
  profileFieldPathFromDomName,
  toCustomerProfileInput,
} from "@/features/account/components/profile-form-schema";
import type { CustomerAvatarPresentation } from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
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
  readonly avatarPresentation?: CustomerAvatarPresentation;
  readonly section?: "profile" | "billing";
};

type AresLookupStatus =
  | "idle"
  | "found"
  | "invalid-ico"
  | "not-found"
  | "unavailable"
  | "applied";

type AresLookupUi = {
  readonly isPending: boolean;
  readonly status: AresLookupStatus;
  readonly review?: AresBusinessBillingDraft;
  readonly message?: string;
  readonly onLookup: () => void;
  readonly onApply: () => void;
  readonly onDismiss: () => void;
};

type AresLookupUiState = {
  status: AresLookupStatus;
  review?: AresBusinessBillingDraft;
  message?: string;
  /** Invalidation generation at which this state was installed. */
  generation?: number;
};

const aresDraftFields = profileBillingFieldNames;

type SavedIdentity = {
  readonly firstName: string;
  readonly lastName: string | null;
};

const profileFieldLayoutClass = (name: keyof ProfileFormValues) => {
  if (name === "companyName" || name === "companyId") return "sm:col-span-2";
  if (name === "addressLine1" || name === "addressLine2") return "min-w-0";
  return undefined;
};

export function ProfileForm({
  avatarPresentation = { kind: "available", avatar: null },
  email,
  locale,
  mode,
  onSectionChange,
  profile,
  section = "profile",
}: ProfileFormProps) {
  const router = useRouter();
  const [savedIdentity, setSavedIdentity] = useState<SavedIdentity>(() => ({
    firstName: profile?.firstName ?? "",
    lastName: profile?.lastName ?? null,
  }));
  const [hasCompletedInitialProfile, setHasCompletedInitialProfile] =
    useState(false);
  const [isRefreshPending, startRefreshTransition] = useTransition();
  const [aresLookup, setAresLookup] = useState<AresLookupUiState>({
    status: "idle",
  });
  // Any IČO edit or billing-kind change bumps the generation; a pending
  // lookup is tagged with the generation at its start, so a response that
  // resolves after an edit is discarded and can never be applied.
  const aresGenerationRef = useRef(0);
  const pendingAresRequestGenerationRef = useRef(0);
  const submittedValuesRef = useRef<ProfileFormValues | undefined>(undefined);
  const submittingRef = useRef(false);

  const isComplete = mode === "complete";
  const isInitialCompletion = isComplete && !hasCompletedInitialProfile;
  const screenCopy = getAccountScreenCopy(locale);

  const form = useForm<ProfileFormValues>({
    resolver: createProfileFormResolver(locale),
    defaultValues: getProfileFormDefaultValues(profile),
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { isDirty: rhfIsDirty } = form.formState;
  // RHF's reset(..., { keepDirtyValues: true }) can leave formState.isDirty
  // false while dirty fields remain, so the guard also compares the live RHF
  // values against the saved baseline (no DOM FormData snapshotting). The
  // comparison runs at guard-event time so it never lags the last keystroke.
  const savedBaselineRef = useRef<ProfileFormValues>(
    getProfileFormDefaultValues(profile)
  );
  const isDirty = () =>
    rhfIsDirty ||
    JSON.stringify(form.getValues()) !==
      JSON.stringify(savedBaselineRef.current);

  const billingKind = useWatch({
    control: form.control,
    name: "billingKind",
  }) as ProfileBillingKind;

  const action = (
    isInitialCompletion ? completeCustomerProfile : updateCustomerProfile
  ) as typeof updateCustomerProfile;

  const invalidateAresLookup = () => {
    aresGenerationRef.current += 1;
    setAresLookup({ status: "idle" });
  };

  const lookupAres = useWorkspaceAction(lookupAresBusiness, {
    actionName: "account.ares-lookup",
    onSuccess: ({ data }) => {
      const lookupResult = data as AresBusinessLookupResult | undefined;
      if (!lookupResult) return;
      // A response that resolves after the IČO or the billing kind changed
      // mid-flight is superseded and must not overwrite newer UI state.
      if (pendingAresRequestGenerationRef.current !== aresGenerationRef.current)
        return;
      if (lookupResult.status === "found") {
        setAresLookup({
          status: "found",
          review: lookupResult.company,
        });
      } else {
        setAresLookup({
          status: lookupResult.status,
          message: lookupResult.message,
        });
      }
    },
    onError: ({ error }) => {
      // A resolved failure (expired session, pending deletion, disabled
      // accounts, …) must surface in the lookup status instead of silently
      // resetting the region, and must be discarded when superseded.
      if (pendingAresRequestGenerationRef.current !== aresGenerationRef.current)
        return;
      setAresLookup({
        status: "unavailable",
        message:
          error.serverError || m.accountAresLookupActionError({}, { locale }),
      });
    },
    onTransportError: () => {
      if (pendingAresRequestGenerationRef.current !== aresGenerationRef.current)
        return;
      setAresLookup({
        status: "unavailable",
        message: m.accountAresLookupActionError({}, { locale }),
      });
    },
  });

  const handleAresLookup = () => {
    if (lookupAres.isExecuting) return;
    setAresLookup({ status: "idle" });
    pendingAresRequestGenerationRef.current = aresGenerationRef.current;
    lookupAres.execute({ ico: form.getValues("companyId") });
  };

  const applyAresReview = () => {
    const review = aresLookup.review;
    if (!review || aresLookup.status !== "found") return;
    for (const field of aresDraftFields) {
      const value = review[field];
      if (value !== undefined) {
        form.setValue(field, value, {
          shouldDirty: true,
          shouldValidate: false,
        });
      }
    }
    setAresLookup({
      status: "applied",
      message: m.accountAresLookupApplied({}, { locale }),
    });
  };

  const dismissAresReview = () => {
    setAresLookup({ status: "idle" });
  };

  const { execute, hasErrored, isExecuting, result } = useWorkspaceAction(
    action,
    {
      actionName: "account.profile",
      onSuccess: () => {
        const submittedValues = submittedValuesRef.current;
        if (submittedValues !== undefined) {
          // The saved baseline becomes the values as they were at submit time
          // while every current value is preserved verbatim: an in-flight edit
          // that returned a field to its original value must not be overwritten
          // by the submitted snapshot, and dirty state is recomputed against
          // the new baseline.
          savedBaselineRef.current = submittedValues;
          form.reset(submittedValues, { keepValues: true });
          setSavedIdentity({
            firstName: submittedValues.firstName.trim(),
            lastName: submittedValues.lastName.trim() || null,
          });
        }
        if (isInitialCompletion) {
          setHasCompletedInitialProfile(true);
        }
        const hasNoEditsSinceSubmit =
          submittedValues !== undefined &&
          JSON.stringify(form.getValues()) === JSON.stringify(submittedValues);
        if (isComplete && hasNoEditsSinceSubmit) {
          startRefreshTransition(() => router.refresh());
        }
      },
    }
  );

  useUnsavedChanges({
    enabled: !isRefreshPending,
    isDirty,
    message: m.accountProfileUnsavedChanges({}, { locale }),
  });

  useEffect(() => {
    if (!isExecuting) submittingRef.current = false;
  }, [isExecuting]);

  // Server validationErrors surface on the matching form fields and, in edit
  // mode, move the customer to the first invalid section.
  const handledValidationResultRef = useRef<unknown>(undefined);
  useEffect(() => {
    const fieldErrors = result.validationErrors?.fieldErrors;
    if (!fieldErrors) return;
    if (handledValidationResultRef.current === result) return;
    handledValidationResultRef.current = result;
    if (fieldErrors.firstName?.length) {
      form.setError("firstName", {
        type: "server",
        message: m.accountProfileFirstNameRequired({}, { locale }),
      });
    }
    if (fieldErrors.phone?.length) {
      form.setError("phone", {
        type: "server",
        message: m.accountProfilePhoneInvalid({}, { locale }),
      });
    }
    if (fieldErrors.lastName?.length) {
      form.setError("lastName", {
        type: "server",
        message: m.accountProfileValidationError({}, { locale }),
      });
    }
    let billingFieldError = false;
    for (const error of fieldErrors.billing ?? []) {
      const fieldName = profileBillingFieldNames.find(
        (field) => error === field || error.startsWith(`${field}:`)
      );
      if (fieldName !== undefined) {
        billingFieldError = true;
        form.setError(fieldName, {
          type: "server",
          message: m.accountProfileValidationError({}, { locale }),
        });
      } else {
        form.setError("billingKind", {
          type: "server",
          message: m.accountProfileValidationError({}, { locale }),
        });
      }
    }
    if (!isComplete) {
      let sectionWithError: "profile" | "billing" | undefined;
      if (
        (fieldErrors.firstName?.length ?? 0) > 0 ||
        (fieldErrors.lastName?.length ?? 0) > 0 ||
        (fieldErrors.phone?.length ?? 0) > 0
      ) {
        sectionWithError = "profile";
      } else if ((fieldErrors.billing?.length ?? 0) > 0 || billingFieldError) {
        sectionWithError = "billing";
      }
      if (sectionWithError !== undefined) {
        onSectionChange?.(sectionWithError);
      }
    }
  }, [form, result, isComplete, locale, onSectionChange]);

  const firstInvalidSectionFromErrors = (
    errors: FieldErrors<ProfileFormValues>
  ): "profile" | "billing" | undefined => {
    const names = Object.keys(errors);
    if (
      names.includes("firstName") ||
      names.includes("lastName") ||
      names.includes("phone")
    ) {
      return "profile";
    }
    if (
      names.some(
        (name) =>
          name === "billingKind" ||
          (profileBillingFieldNames as readonly string[]).includes(name)
      )
    ) {
      return "billing";
    }
    return undefined;
  };

  const handleValid = (values: ProfileFormValues) => {
    if (isExecuting || submittingRef.current) return;
    submittedValuesRef.current = values;
    submittingRef.current = true;
    // The resolver has already validated this mapping against the contract
    // schema (updateCustomerProfileStandardSchema), so client and server
    // share trimming and length rules.
    execute(toCustomerProfileInput(values));
  };

  const handleInvalid = (errors: FieldErrors<ProfileFormValues>) => {
    if (isComplete) return;
    const firstInvalidSection = firstInvalidSectionFromErrors(errors);
    if (firstInvalidSection !== undefined && section !== firstInvalidSection) {
      onSectionChange?.(firstInvalidSection);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void form.handleSubmit(handleValid, handleInvalid)(event);
  };

  const handleInvalidCapture = (event: InvalidEvent<HTMLFormElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const fieldName = target.getAttribute("name");
    if (fieldName === null) return;
    const fieldPath = profileFieldPathFromDomName(fieldName);

    if (fieldPath === "firstName") {
      form.setError("firstName", {
        type: "required",
        message: m.accountProfileFirstNameRequired({}, { locale }),
      });
    }
    if (fieldPath === "companyName") {
      form.setError("companyName", {
        type: "required",
        message: m.accountProfileValidationError({}, { locale }),
      });
    }

    const invalidInputs = Array.from(event.currentTarget.elements).filter(
      (element): element is HTMLInputElement =>
        element instanceof HTMLInputElement && !element.validity.valid
    );
    const firstInvalidFieldName = invalidInputs
      .map(({ name }) => profileFieldPathFromDomName(name))
      .find(
        (name) =>
          name === "firstName" ||
          name === "phone" ||
          (profileBillingFieldNames as readonly string[]).includes(name)
      );
    let firstInvalidSection: "profile" | "billing" | undefined;
    if (
      firstInvalidFieldName === "firstName" ||
      firstInvalidFieldName === "phone"
    ) {
      firstInvalidSection = "profile";
    } else if (
      firstInvalidFieldName !== undefined &&
      (profileBillingFieldNames as readonly string[]).includes(
        firstInvalidFieldName
      )
    ) {
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

  const submitLabel = isComplete
    ? m.accountCompletionSubmit({}, { locale })
    : m.accountProfileSave({}, { locale });
  const validationErrors = result.validationErrors;
  const hasValidationErrors = Boolean(
    validationErrors && Object.keys(validationErrors).length > 0
  );

  const renderTextField = (
    name: keyof ProfileFormValues,
    options: {
      readonly autoComplete?: string;
      // Legacy public DOM contract: some billing inputs keep their
      // pre-RHF `name` attributes (consumed by the account-visual
      // harness and native validation messages) even though the RHF
      // field path differs.
      readonly domName?: string;
      readonly id: string;
      readonly inputMode?: "numeric";
      readonly label: string;
      readonly maxLength: number;
      readonly required?: boolean;
    }
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => {
        const describedBy = [
          fieldState.error ? `${options.id}-error` : undefined,
          name === "companyId" && aresLookup.status === "invalid-ico"
            ? "account-profile-ares-status"
            : undefined,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <FormItem className={profileFieldLayoutClass(name)}>
            <Label htmlFor={options.id} id={`${options.id}-label`}>
              {options.label}
            </Label>
            <FormControl>
              <Input
                {...field}
                aria-describedby={describedBy || undefined}
                aria-invalid={
                  Boolean(fieldState.error) ||
                  (name === "companyId" &&
                    aresLookup.status === "invalid-ico") ||
                  undefined
                }
                aria-labelledby={`${options.id}-label`}
                autoComplete={options.autoComplete}
                id={options.id}
                inputMode={options.inputMode}
                maxLength={options.maxLength}
                name={options.domName ?? name}
                required={options.required}
              />
            </FormControl>
            {fieldState.error ? (
              <FormMessage
                className="text-sm font-normal text-red-700"
                id={`${options.id}-error`}
              />
            ) : null}
          </FormItem>
        );
      }}
    />
  );

  const identityFields = (
    <>
      {renderTextField("firstName", {
        autoComplete: "given-name",
        id: "account-profile-first-name",
        label: m.accountProfileFirstNameLabel({}, { locale }),
        maxLength: 100,
        required: true,
      })}
      {renderTextField("lastName", {
        autoComplete: "family-name",
        id: "account-profile-last-name",
        label: m.accountProfileLastNameLabel({}, { locale }),
        maxLength: 100,
      })}
      {renderTextField("phone", {
        autoComplete: "tel",
        id: "account-profile-phone",
        label: m.accountProfilePhoneLabel({}, { locale }),
        maxLength: 32,
      })}
    </>
  );

  const aresButtonLabel = (() => {
    if (lookupAres.isExecuting) {
      return m.accountAresLookupLoading({}, { locale });
    }
    if (
      aresLookup.status === "not-found" ||
      aresLookup.status === "unavailable"
    ) {
      return m.accountAresLookupRetry({}, { locale });
    }
    return m.accountAresLookupSubmit({}, { locale });
  })();

  // The live region announces pending, found-for-review, and terminal
  // outcomes; the review panel itself stays outside the region so nothing
  // steals focus from manual entry.
  const aresStatusContent = (() => {
    if (lookupAres.isExecuting) {
      return <span>{m.accountAresLookupLoading({}, { locale })}</span>;
    }
    if (aresLookup.status === "found") {
      return (
        <span className="text-emerald-800">
          {m.accountAresLookupReviewReady({}, { locale })}
        </span>
      );
    }
    if (aresLookup.message) {
      return (
        <span
          className={
            aresLookup.status === "invalid-ico" ||
            aresLookup.status === "not-found" ||
            aresLookup.status === "unavailable"
              ? "text-red-700"
              : "text-emerald-800"
          }
        >
          {aresLookup.message}
        </span>
      );
    }
    return null;
  })();

  useEffect(() => {
    if (aresLookup.status !== "invalid-ico") return;
    document.getElementById("account-profile-billing-company-id")?.focus();
  }, [aresLookup.status]);

  const billingFields = (
    <>
      <FormField
        control={form.control}
        name="billingKind"
        render={({ field, fieldState }) => (
          <FormItem className="sm:col-span-2">
            <Label
              htmlFor="account-profile-billing-kind"
              id="account-profile-billing-kind-label"
            >
              {m.accountProfileBillingKindLabel({}, { locale })}
            </Label>
            <FormControl>
              <select
                {...field}
                aria-describedby={
                  fieldState.error ? "account-profile-billing-error" : undefined
                }
                aria-invalid={Boolean(fieldState.error) || undefined}
                aria-labelledby="account-profile-billing-kind-label"
                className="w-full rounded-xl border border-navy-blue/14 bg-white px-3 py-2.5 text-navy-blue"
                id="account-profile-billing-kind"
                name={undefined}
                onChange={(event) => {
                  field.onChange(event);
                  invalidateAresLookup();
                }}
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
            </FormControl>
            {fieldState.error ? (
              <FormMessage
                className="text-sm font-normal text-red-700"
                id="account-profile-billing-error"
              />
            ) : null}
          </FormItem>
        )}
      />
      {billingKind !== "hidden" ? (
        <>
          {billingKind === "business" ? (
            <>
              {renderTextField("companyName", {
                domName: "billingCompanyName",
                id: "account-profile-billing-company-name",
                label: m.accountProfileCompanyNameLabel({}, { locale }),
                maxLength: 200,
                required: true,
              })}
              <FormItem className="sm:col-span-2">
                <Label
                  htmlFor="account-profile-billing-company-id"
                  id="account-profile-billing-company-id-label"
                >
                  {m.accountAresLookupIcoLabel({}, { locale })}
                </Label>
                <FormField
                  control={form.control}
                  name="companyId"
                  render={({ field, fieldState }) => {
                    const describedBy = [
                      fieldState.error
                        ? "account-profile-billing-company-id-error"
                        : undefined,
                      aresLookup.status === "invalid-ico"
                        ? "account-profile-ares-status"
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <>
                        <FormControl>
                          <Input
                            {...field}
                            aria-describedby={describedBy || undefined}
                            aria-invalid={
                              Boolean(fieldState.error) ||
                              aresLookup.status === "invalid-ico" ||
                              undefined
                            }
                            aria-labelledby="account-profile-billing-company-id-label"
                            id="account-profile-billing-company-id"
                            inputMode="numeric"
                            maxLength={32}
                            name="billingCompanyId"
                            onChange={(event) => {
                              field.onChange(event);
                              invalidateAresLookup();
                            }}
                          />
                        </FormControl>
                        {fieldState.error ? (
                          <FormMessage
                            className="text-sm font-normal text-red-700"
                            id="account-profile-billing-company-id-error"
                          />
                        ) : null}
                      </>
                    );
                  }}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    className="rounded-xl bg-navy-blue px-4 text-xs uppercase tracking-[0.08em] hover:bg-navy-blue/90"
                    disabled={lookupAres.isExecuting}
                    onClick={handleAresLookup}
                    size="sm"
                    type="button"
                  >
                    {aresButtonLabel}
                  </Button>
                </div>
                <p
                  aria-live="polite"
                  className="min-h-5 text-sm"
                  id="account-profile-ares-status"
                >
                  {aresStatusContent}
                </p>
                {Boolean(
                  aresLookup.review && aresLookup.status === "found"
                ) && (
                  <AresReviewPanel
                    ares={{
                      isPending: lookupAres.isExecuting,
                      status: aresLookup.status,
                      review: aresLookup.review,
                      message: aresLookup.message,
                      onLookup: handleAresLookup,
                      onApply: applyAresReview,
                      onDismiss: dismissAresReview,
                    }}
                    locale={locale}
                  />
                )}
              </FormItem>
              {renderTextField("vatId", {
                domName: "billingVatId",
                id: "account-profile-billing-vat-id",
                label: m.accountProfileVatIdLabel({}, { locale }),
                maxLength: 32,
              })}
            </>
          ) : null}
          {renderTextField("addressLine1", {
            domName: "billingAddressLine1",
            id: "account-profile-billing-address-line1",
            label: m.accountProfileAddressLine1Label({}, { locale }),
            maxLength: 200,
          })}
          {renderTextField("addressLine2", {
            domName: "billingAddressLine2",
            id: "account-profile-billing-address-line2",
            label: m.accountProfileAddressLine2Label({}, { locale }),
            maxLength: 200,
          })}
          {renderTextField("city", {
            domName: "billingCity",
            id: "account-profile-billing-city",
            label: m.accountProfileCityLabel({}, { locale }),
            maxLength: 100,
          })}
          <div className="min-w-0 grid gap-5 sm:grid-cols-2">
            {renderTextField("zip", {
              domName: "billingZip",
              id: "account-profile-billing-zip",
              label: m.accountProfileZipLabel({}, { locale }),
              maxLength: 20,
            })}
            {renderTextField("country", {
              domName: "billingCountry",
              autoComplete: "country",
              id: "account-profile-billing-country",
              label: m.accountProfileCountryLabel({}, { locale }),
              maxLength: 2,
            })}
          </div>
        </>
      ) : null}
    </>
  );

  const formFooter = (
    <>
      <div
        aria-live="polite"
        className="min-h-5 text-sm"
        id="account-profile-feedback"
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
        {hasErrored && !result.serverError && !hasValidationErrors && (
          <p className="text-red-700">
            {m.accountProfileError({}, { locale })}
          </p>
        )}
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
        disabled={isExecuting || isRefreshPending}
        id="account-profile-submit"
        size={isComplete ? "default" : "sm"}
        type="submit"
      >
        {isExecuting ? m.accountProfileSaving({}, { locale }) : submitLabel}
      </Button>
    </>
  );

  return (
    <Form {...form}>
      <form
        aria-busy={isRefreshPending}
        aria-describedby="account-profile-feedback"
        id="account-profile-form"
        onInvalidCapture={handleInvalidCapture}
        onSubmit={handleSubmit}
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
                    aria-readonly="true"
                    autoComplete="email"
                    className="bg-navy-blue/3 text-navy-blue/70"
                    id="account-profile-email"
                    readOnly
                    type="email"
                    value={email}
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
                  avatar={
                    avatarPresentation.kind === "available" ? (
                      <AvatarControl
                        avatar={avatarPresentation.avatar}
                        firstName={savedIdentity.firstName}
                        lastName={savedIdentity.lastName}
                        locale={locale}
                      />
                    ) : undefined
                  }
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
                  <div className="grid gap-5 sm:grid-cols-2">
                    {billingFields}
                  </div>
                </BillingScreen>
              </div>
            </>
          )}
        </fieldset>
      </form>
    </Form>
  );
}

function AresReviewPanel({
  ares,
  locale,
}: {
  readonly ares: AresLookupUi;
  readonly locale: Locale;
}) {
  const review = ares.review;
  if (!review) return null;
  const presentEntries = (
    [
      ["companyName", m.accountProfileCompanyNameLabel({}, { locale })],
      ["companyId", m.accountProfileCompanyIdLabel({}, { locale })],
      ["vatId", m.accountProfileVatIdLabel({}, { locale })],
      ["addressLine1", m.accountProfileAddressLine1Label({}, { locale })],
      ["addressLine2", m.accountProfileAddressLine2Label({}, { locale })],
      ["city", m.accountProfileCityLabel({}, { locale })],
      ["zip", m.accountProfileZipLabel({}, { locale })],
      ["country", m.accountProfileCountryLabel({}, { locale })],
    ] as const
  ).filter(([field]) => review[field] !== undefined);

  return (
    <div className="space-y-3 rounded-2xl border border-navy-blue/12 bg-navy-blue/3 p-4">
      <p className="text-sm font-bold text-navy-blue">
        {m.accountAresLookupReviewTitle({}, { locale })}
      </p>
      <dl className="grid gap-1 text-sm text-navy-blue">
        {presentEntries.map(([field, label]) => (
          <div className="flex min-w-0 gap-2" key={field}>
            <dt className="shrink-0 font-semibold">{label}:</dt>
            <dd className="min-w-0 break-words">{review[field]}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button
          className="rounded-xl bg-burned-orange px-4 text-xs uppercase tracking-[0.08em] hover:bg-burned-orange/90"
          onClick={ares.onApply}
          size="sm"
          type="button"
        >
          {m.accountAresLookupApply({}, { locale })}
        </Button>
        <Button
          className="rounded-xl border border-navy-blue/14 px-4 text-xs uppercase tracking-[0.08em] text-navy-blue hover:bg-navy-blue/5"
          onClick={ares.onDismiss}
          size="sm"
          type="button"
          variant="ghost"
        >
          {m.accountAresLookupDismiss({}, { locale })}
        </Button>
      </div>
    </div>
  );
}
