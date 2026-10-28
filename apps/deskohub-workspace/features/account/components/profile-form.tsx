"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
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
  completeCustomerProfile,
  updateCustomerProfile,
} from "@/features/account/actions";
import { refreshAnalyticsDotyposCustomerId } from "@/features/account/analytics-customer-link";
import type { AresBusinessBillingDraft } from "@/features/account/backend/ares-business-draft";
import { BillingScreen } from "@/features/account/components/billing/billing-screen";
import { AvatarControl } from "@/features/account/components/profile/avatar-control";
import { ProfileScreen } from "@/features/account/components/profile/profile-screen";
import {
  completionFormSchema,
  firstInvalidProfileFormSection,
  type ProfileFormField,
  type ProfileFormSection,
  type ProfileFormValues,
  profileBillingFieldNames,
  profileFormDefaults,
  profileFormErrorMessage,
  profileFormFieldOfInputName,
  profileFormInputName,
  profileFormSchema,
  toProfileFormErrors,
} from "@/features/account/components/profile-form-model";
import { useAresBusinessLookup } from "@/features/account/components/use-ares-business-lookup";
import type {
  CustomerAvatarPresentation,
  CustomerProfile,
} from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";
import type { ReferralCode } from "@/features/referrals/client";
import { formatReferralInvitationDiscount } from "@/features/referrals/client";
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
  readonly onSectionChange?: (section: ProfileFormSection) => void;
  readonly profile?: CustomerProfile;
  readonly avatarPresentation?: CustomerAvatarPresentation;
  /** Server-checked invitation code that prefills first-time completion. */
  readonly referralCode?: ReferralCode;
  /**
   * Whether first-time completion offers the referral code field; only a
   * released referral program does.
   */
  readonly referralsEnabled?: boolean;
  readonly section?: ProfileFormSection;
};

type SavedIdentity = {
  readonly firstName: string;
  readonly lastName: string | null;
};

const profileFieldLayoutClass = (name: ProfileFormField) => {
  if (name === "companyName" || name === "companyId") return "@xl:col-span-2";
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
  referralCode,
  referralsEnabled = false,
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
  const aresLookup = useAresBusinessLookup(locale);
  const submittedValuesRef = useRef<ProfileFormValues | undefined>(undefined);
  const submittingRef = useRef(false);

  const isComplete = mode === "complete";
  const isInitialCompletion = isComplete && !hasCompletedInitialProfile;

  // Initial completion also submits the referral code; every later save
  // submits the plain profile contract.
  const formSchema = isInitialCompletion
    ? completionFormSchema(locale, referralCode)
    : profileFormSchema(locale);
  const form = useForm<
    typeof formSchema.Encoded,
    unknown,
    typeof formSchema.Type
  >({
    resolver: effectSchemaResolver(formSchema),
    defaultValues: profileFormDefaults(profile, referralCode),
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { isDirty: rhfIsDirty } = form.formState;
  // RHF's reset(..., { keepDirtyValues: true }) can leave formState.isDirty
  // false while dirty fields remain, so the guard also compares the live RHF
  // values against the saved baseline (no DOM FormData snapshotting). The
  // comparison runs at guard-event time so it never lags the last keystroke.
  const savedBaselineRef = useRef<ProfileFormValues>(
    profileFormDefaults(profile, referralCode)
  );
  const isDirty = () =>
    rhfIsDirty ||
    JSON.stringify(form.getValues()) !==
      JSON.stringify(savedBaselineRef.current);

  const billingKind = useWatch({
    control: form.control,
    name: "billingKind",
  });

  const action = (
    isInitialCompletion ? completeCustomerProfile : updateCustomerProfile
  ) as typeof completeCustomerProfile;

  const showReferralCodeUnavailable = () =>
    form.setError(
      "referralCode",
      {
        type: "server",
        message: profileFormErrorMessage("referralCode", locale),
      },
      { shouldFocus: true }
    );

  const applyAresReview = () => {
    const review = aresLookup.apply();
    if (!review) return;
    for (const field of profileBillingFieldNames) {
      const value = review[field];
      if (value !== undefined) {
        form.setValue(field, value, {
          shouldDirty: true,
          shouldValidate: false,
        });
      }
    }
  };

  const { execute, hasErrored, isExecuting, result } = useWorkspaceAction(
    action,
    {
      onSuccess: ({ data }) => {
        if (data?.status === "referral-code-unavailable") {
          showReferralCodeUnavailable();
          return;
        }
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
          // Completion creates the Dotypos customer the analytics person links to.
          refreshAnalyticsDotyposCustomerId();
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
    const { errors, firstSection } = toProfileFormErrors(
      { fieldErrors },
      locale
    );
    for (const [field, message] of Object.entries(errors)) {
      form.setError(field as ProfileFormField, { type: "server", message });
    }
    if (!isComplete && firstSection !== undefined) {
      onSectionChange?.(firstSection);
    }
  }, [form, result, isComplete, locale, onSectionChange]);

  const handleValid = (input: typeof formSchema.Type) => {
    if (isExecuting || submittingRef.current) return;
    submittedValuesRef.current = form.getValues();
    submittingRef.current = true;
    execute(input);
  };

  const handleInvalid = (errors: FieldErrors<ProfileFormValues>) => {
    if (isComplete) return;
    const firstInvalidSection = firstInvalidProfileFormSection(
      Object.keys(errors)
    );
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
    const field = profileFormFieldOfInputName(
      target.getAttribute("name") ?? ""
    );
    // `required` is the only native constraint a profile input can fail.
    if (field !== undefined) {
      form.setError(field, {
        type: "required",
        message: profileFormErrorMessage(field, locale),
      });
    }

    const firstInvalidSection = firstInvalidProfileFormSection(
      Array.from(event.currentTarget.elements).flatMap((element) =>
        element instanceof HTMLInputElement && !element.validity.valid
          ? (profileFormFieldOfInputName(element.name) ?? [])
          : []
      )
    );
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
    name: ProfileFormField,
    options: {
      readonly autoComplete?: string;
      readonly id: string;
      readonly inputMode?: "numeric";
      readonly label: string;
      readonly maxLength: number;
      readonly required?: boolean;
      readonly type?: "tel";
    }
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => {
        const describedBy = [
          fieldState.error ? `${options.id}-error` : undefined,
          name === "companyId" && aresLookup.state.status === "invalid-ico"
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
                    aresLookup.state.status === "invalid-ico") ||
                  undefined
                }
                aria-labelledby={`${options.id}-label`}
                autoComplete={options.autoComplete}
                id={options.id}
                inputMode={options.inputMode}
                maxLength={options.maxLength}
                name={profileFormInputName(name)}
                required={options.required}
                type={options.type}
              />
            </FormControl>
            <FormMessage
              className="text-sm font-normal text-red-700"
              id={`${options.id}-error`}
            />
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
        type: "tel",
      })}
    </>
  );

  const aresButtonLabel = (() => {
    if (aresLookup.isPending) {
      return m.accountAresLookupLoading({}, { locale });
    }
    if (
      aresLookup.state.status === "not-found" ||
      aresLookup.state.status === "unavailable"
    ) {
      return m.accountAresLookupRetry({}, { locale });
    }
    return m.accountAresLookupSubmit({}, { locale });
  })();

  // The live region announces pending, found-for-review, and terminal
  // outcomes; the review panel itself stays outside the region so nothing
  // steals focus from manual entry.
  const aresStatusContent = (() => {
    if (aresLookup.isPending) {
      return <span>{m.accountAresLookupLoading({}, { locale })}</span>;
    }
    if (aresLookup.state.status === "found") {
      return (
        <span className="text-emerald-800">
          {m.accountAresLookupReviewReady({}, { locale })}
        </span>
      );
    }
    if (aresLookup.state.status !== "idle" && aresLookup.state.message) {
      return (
        <span
          className={
            aresLookup.state.status === "invalid-ico" ||
            aresLookup.state.status === "not-found" ||
            aresLookup.state.status === "unavailable"
              ? "text-red-700"
              : "text-emerald-800"
          }
        >
          {aresLookup.state.message}
        </span>
      );
    }
    return null;
  })();

  useEffect(() => {
    if (aresLookup.state.status !== "invalid-ico") return;
    document.getElementById("account-profile-billing-company-id")?.focus();
  }, [aresLookup.state.status]);

  const billingFields = (
    <>
      <FormField
        control={form.control}
        name="billingKind"
        render={({ field, fieldState }) => (
          <FormItem className="@xl:col-span-2">
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
                  aresLookup.invalidate();
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
            <FormMessage
              className="text-sm font-normal text-red-700"
              id="account-profile-billing-error"
            />
          </FormItem>
        )}
      />
      {billingKind !== "hidden" ? (
        <>
          {billingKind === "business" ? (
            <>
              {renderTextField("companyName", {
                autoComplete: "organization",
                id: "account-profile-billing-company-name",
                label: m.accountProfileCompanyNameLabel({}, { locale }),
                maxLength: 200,
                required: true,
              })}
              <FormItem className="@xl:col-span-2">
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
                      aresLookup.state.status === "invalid-ico"
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
                              aresLookup.state.status === "invalid-ico" ||
                              undefined
                            }
                            aria-labelledby="account-profile-billing-company-id-label"
                            id="account-profile-billing-company-id"
                            inputMode="numeric"
                            maxLength={32}
                            name={profileFormInputName("companyId")}
                            onChange={(event) => {
                              field.onChange(event);
                              aresLookup.invalidate();
                            }}
                          />
                        </FormControl>
                        <FormMessage
                          className="text-sm font-normal text-red-700"
                          id="account-profile-billing-company-id-error"
                        />
                      </>
                    );
                  }}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    caps
                    disabled={aresLookup.isPending}
                    onClick={() =>
                      aresLookup.lookUp(form.getValues("companyId"))
                    }
                    shape="rounded"
                    size="sm"
                    tone="navy-blue"
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
                {aresLookup.state.status === "found" && (
                  <AresReviewPanel
                    locale={locale}
                    onApply={applyAresReview}
                    onDismiss={aresLookup.dismiss}
                    review={aresLookup.state.review}
                  />
                )}
              </FormItem>
              {renderTextField("vatId", {
                id: "account-profile-billing-vat-id",
                label: m.accountProfileVatIdLabel({}, { locale }),
                maxLength: 32,
              })}
            </>
          ) : null}
          {renderTextField("addressLine1", {
            autoComplete: "address-line1",
            id: "account-profile-billing-address-line1",
            label: m.accountProfileAddressLine1Label({}, { locale }),
            maxLength: 200,
          })}
          {renderTextField("addressLine2", {
            autoComplete: "address-line2",
            id: "account-profile-billing-address-line2",
            label: m.accountProfileAddressLine2Label({}, { locale }),
            maxLength: 200,
          })}
          {renderTextField("city", {
            autoComplete: "address-level2",
            id: "account-profile-billing-city",
            label: m.accountProfileCityLabel({}, { locale }),
            maxLength: 100,
          })}
          <div className="min-w-0 grid gap-5 @xl:grid-cols-2">
            {renderTextField("zip", {
              autoComplete: "postal-code",
              id: "account-profile-billing-zip",
              label: m.accountProfileZipLabel({}, { locale }),
              maxLength: 20,
            })}
            {renderTextField("country", {
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
        {result.data && result.data.status !== "referral-code-unavailable" ? (
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
        caps={!isComplete}
        disabled={isExecuting || isRefreshPending}
        id="account-profile-submit"
        shape={isComplete ? "pill" : "rounded"}
        size={isComplete ? "default" : "sm"}
        tone={
          !isComplete && section === "billing" ? "navy-blue" : "burned-orange"
        }
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
          {mode === "complete" ? (
            <>
              <div className="grid gap-5 @xl:grid-cols-2">
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

              {isInitialCompletion && referralsEnabled && (
                <FormField
                  control={form.control}
                  name="referralCode"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <Label
                        htmlFor="profile-referral-code"
                        id="profile-referral-code-label"
                      >
                        {m.accountProfileReferralCodeLabel({}, { locale })}
                      </Label>
                      <FormControl>
                        <Input
                          {...field}
                          aria-describedby={[
                            "profile-referral-code-hint",
                            fieldState.error
                              ? "profile-referral-code-error"
                              : undefined,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          aria-invalid={Boolean(fieldState.error) || undefined}
                          aria-labelledby="profile-referral-code-label"
                          autoCapitalize="characters"
                          autoComplete="off"
                          className="uppercase"
                          data-ph-mask
                          id="profile-referral-code"
                          maxLength={64}
                          name={profileFormInputName("referralCode")}
                          spellCheck={false}
                        />
                      </FormControl>
                      <p
                        className="text-sm text-navy-blue/68"
                        id="profile-referral-code-hint"
                      >
                        {m.accountProfileReferralCodeHint(
                          {
                            discount: formatReferralInvitationDiscount(locale),
                          },
                          { locale }
                        )}
                      </p>
                      <FormMessage
                        className="text-sm font-normal text-red-700"
                        id="profile-referral-code-error"
                      />
                    </FormItem>
                  )}
                />
              )}

              <details className="rounded-2xl border border-navy-blue/12 p-4">
                <summary className="cursor-pointer text-sm font-bold text-navy-blue">
                  {m.accountProfileBillingSummary({}, { locale })}
                </summary>
                <div className="mt-4 grid gap-5 @xl:grid-cols-2">
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
                  footer={section === "billing" ? formFooter : undefined}
                  locale={locale}
                >
                  <div className="grid gap-5 @xl:grid-cols-2">
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
  locale,
  onApply,
  onDismiss,
  review,
}: {
  readonly locale: Locale;
  readonly onApply: () => void;
  readonly onDismiss: () => void;
  readonly review: AresBusinessBillingDraft;
}) {
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
        <Button caps onClick={onApply} shape="rounded" size="sm" type="button">
          {m.accountAresLookupApply({}, { locale })}
        </Button>
        <Button
          caps
          onClick={onDismiss}
          shape="rounded"
          size="sm"
          tone="outline"
          type="button"
          variant="ghost"
        >
          {m.accountAresLookupDismiss({}, { locale })}
        </Button>
      </div>
    </div>
  );
}
