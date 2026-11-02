"use client";

import type { ProfileFormSection } from "@/features/account/components/profile-form-model";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

/** The latest profile save's result, as `useWorkspaceAction` reports it. */
type ProfileSaveResult = {
  readonly data?: { readonly status: string };
  readonly serverError?: string;
  readonly validationErrors?: object;
};

type ProfileFormFooterProps = {
  readonly locale: Locale;
  readonly isComplete: boolean;
  readonly section: ProfileFormSection;
  readonly result: ProfileSaveResult;
  readonly hasErrored: boolean;
  readonly isExecuting: boolean;
  readonly isRefreshPending: boolean;
};

/**
 * Why the latest save failed: the server's own message, a validation
 * failure, or any other error. At most one shows.
 */
const profileSaveFailureMessage = (
  result: ProfileSaveResult,
  hasErrored: boolean,
  locale: Locale
) => {
  if (result.serverError) return result.serverError;
  const { validationErrors } = result;
  if (validationErrors && Object.keys(validationErrors).length > 0) {
    return m.accountProfileValidationError({}, { locale });
  }
  return hasErrored ? m.accountProfileError({}, { locale }) : undefined;
};

/** The save feedback region and the submit button below the form. */
export function ProfileFormFooter({
  locale,
  isComplete,
  section,
  result,
  hasErrored,
  isExecuting,
  isRefreshPending,
}: ProfileFormFooterProps) {
  const failureMessage = profileSaveFailureMessage(result, hasErrored, locale);
  return (
    <>
      <div
        aria-live="polite"
        className="min-h-5 text-sm"
        id="account-profile-feedback"
      >
        {result.data && result.data.status !== "referral-code-unavailable" && (
          <p className="text-emerald-800">
            {isComplete
              ? m.accountCompletionSaved({}, { locale })
              : m.accountProfileSaved({}, { locale })}
          </p>
        )}
        {failureMessage && <p className="text-red-700">{failureMessage}</p>}
      </div>

      <ProfileFormSubmitButton
        isComplete={isComplete}
        isExecuting={isExecuting}
        isRefreshPending={isRefreshPending}
        locale={locale}
        section={section}
      />
    </>
  );
}

function ProfileFormSubmitButton({
  locale,
  isComplete,
  section,
  isExecuting,
  isRefreshPending,
}: Omit<ProfileFormFooterProps, "result" | "hasErrored">) {
  const { shape, size, label } = isComplete
    ? ({
        shape: "pill",
        size: "default",
        label: m.accountCompletionSubmit,
      } as const)
    : ({ shape: "rounded", size: "sm", label: m.accountProfileSave } as const);
  return (
    <Button
      caps={!isComplete}
      disabled={isExecuting || isRefreshPending}
      id="account-profile-submit"
      shape={shape}
      size={size}
      tone={
        !isComplete && section === "billing" ? "navy-blue" : "burned-orange"
      }
      type="submit"
    >
      {isExecuting
        ? m.accountProfileSaving({}, { locale })
        : label({}, { locale })}
    </Button>
  );
}
