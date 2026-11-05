"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type InvalidEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { type FieldErrors, useForm } from "react-hook-form";
import {
  completeCustomerProfile,
  updateCustomerProfile,
} from "@/features/account/actions";
import { refreshAnalyticsDotyposCustomerId } from "@/features/account/analytics-customer-link";
import { BillingScreen } from "@/features/account/components/billing/billing-screen";
import { AvatarControl } from "@/features/account/components/profile/avatar-control";
import { ProfileScreen } from "@/features/account/components/profile/profile-screen";
import { ProfileBillingFields } from "@/features/account/components/profile-billing-fields";
import {
  ProfileIdentityFields,
  ProfileReferralCodeField,
} from "@/features/account/components/profile-form-fields";
import { ProfileFormFooter } from "@/features/account/components/profile-form-footer";
import {
  completionFormSchema,
  firstInvalidProfileFormSection,
  type ProfileFormField,
  type ProfileFormSection,
  type ProfileFormValues,
  profileFormDefaults,
  profileFormErrorMessage,
  profileFormFieldOfInputName,
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
import { Form } from "@/shared/components/ui/form";
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

export function ProfileForm({
  avatarPresentation,
  email,
  locale,
  mode,
  onSectionChange,
  profile,
  referralCode,
  referralsEnabled,
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

  useEffect(() => {
    if (aresLookup.state.status !== "invalid-ico") return;
    document.getElementById("account-profile-billing-company-id")?.focus();
  }, [aresLookup.state.status]);

  const footer = (
    <ProfileFormFooter
      hasErrored={hasErrored}
      isComplete={isComplete}
      isExecuting={isExecuting}
      isRefreshPending={isRefreshPending}
      locale={locale}
      result={result}
      section={section}
    />
  );
  const identityFields = <ProfileIdentityFields locale={locale} />;
  const billingFields = (
    <ProfileBillingFields aresLookup={aresLookup} locale={locale} />
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
            <ProfileCompletionLayout
              billingFields={billingFields}
              email={email}
              footer={footer}
              identityFields={identityFields}
              isInitialCompletion={isInitialCompletion}
              locale={locale}
              referralsEnabled={referralsEnabled}
            />
          ) : (
            <ProfileEditLayout
              avatarPresentation={avatarPresentation}
              billingFields={billingFields}
              email={email}
              footer={footer}
              identityFields={identityFields}
              locale={locale}
              savedIdentity={savedIdentity}
              section={section}
            />
          )}
        </fieldset>
      </form>
    </Form>
  );
}

type ProfileFormLayoutProps = {
  readonly email: string;
  readonly locale: Locale;
  readonly identityFields: ReactNode;
  readonly billingFields: ReactNode;
  readonly footer: ReactNode;
};

/** First-time completion: one page with billing folded away. */
function ProfileCompletionLayout({
  billingFields,
  email,
  footer,
  identityFields,
  isInitialCompletion,
  locale,
  referralsEnabled = false,
}: ProfileFormLayoutProps & {
  readonly isInitialCompletion: boolean;
  readonly referralsEnabled?: boolean;
}) {
  return (
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
        <ProfileReferralCodeField locale={locale} />
      )}

      <details className="rounded-2xl border border-navy-blue/12 p-4">
        <summary className="cursor-pointer text-sm font-bold text-navy-blue">
          {m.accountProfileBillingSummary({}, { locale })}
        </summary>
        <div className="mt-4 grid gap-5 @xl:grid-cols-2">{billingFields}</div>
      </details>

      {footer}
    </>
  );
}

/** Editing a completed profile: the profile and billing sections. */
function ProfileEditLayout({
  avatarPresentation = { kind: "available", avatar: null },
  billingFields,
  email,
  footer,
  identityFields,
  locale,
  savedIdentity,
  section,
}: ProfileFormLayoutProps & {
  readonly avatarPresentation?: CustomerAvatarPresentation;
  readonly savedIdentity: SavedIdentity;
  readonly section: ProfileFormSection;
}) {
  return (
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
          footer={section === "profile" ? footer : undefined}
          lastName={savedIdentity.lastName}
          locale={locale}
        >
          {identityFields}
        </ProfileScreen>
      </div>
      <div hidden={section !== "billing"}>
        <BillingScreen
          footer={section === "billing" ? footer : undefined}
          locale={locale}
        >
          <div className="grid gap-5 @xl:grid-cols-2">{billingFields}</div>
        </BillingScreen>
      </div>
    </>
  );
}
