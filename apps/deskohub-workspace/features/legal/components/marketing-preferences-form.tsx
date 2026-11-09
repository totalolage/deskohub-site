"use client";

import { getAccountSignInPath } from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import type {
  MarketingPreferencesRejectionReason,
  MarketingPreferencesState,
} from "@/features/legal/marketing-preferences";
import { Button } from "@/shared/components/ui/button";
import { PreferenceRow } from "@/shared/components/ui/preference-row";
import { Switch } from "@/shared/components/ui/switch";
import {
  getMarketingPreferencesFormContext,
  type MarketingFeedback,
  type MarketingFeedbackKind,
  useMarketingPreferencesActions,
} from "./use-marketing-preferences-actions";

export interface MarketingPreferencesFormProps {
  readonly locale: Locale;
  readonly state: MarketingPreferencesState;
}

export function MarketingPreferencesForm({
  locale,
  state,
}: MarketingPreferencesFormProps) {
  return (
    <MarketingPreferencesFormContent
      // Fence local feedback to one management context. The status stays out of
      // the key: router.refresh() delivers the saved status as new props, and
      // remounting would drop the success feedback and the switch's focus.
      key={`${"source" in state ? state.source : "none"}:${"context" in state ? state.context : "none"}:${"dismissalContext" in state ? state.dismissalContext : "none"}`}
      locale={locale}
      state={state}
    />
  );
}

type FeedbackMessage = (locale: Locale) => string;

/** A refused request's reason has its own copy, whatever the action. */
const rejectionReasonMessages = {
  "invalid-link": (locale) =>
    m.marketingPreferencesFormInvalidLinkError({}, { locale }),
  "pending-confirmation-required": (locale) =>
    m.marketingPreferencesFormConfirmationRequiredError({}, { locale }),
  "stale-context": (locale) =>
    m.marketingPreferencesFormStaleContextError({}, { locale }),
} satisfies Record<MarketingPreferencesRejectionReason, FeedbackMessage>;

const actionOutcomeMessages = {
  clear: {
    error: (locale) => m.marketingPreferencesFormClearError({}, { locale }),
    success: (locale) => m.marketingPreferencesFormCleared({}, { locale }),
  },
  confirm: {
    error: (locale) => m.marketingPreferencesFormConfirmError({}, { locale }),
    success: (locale) => m.marketingPreferencesFormConfirmed({}, { locale }),
  },
  save: {
    error: (locale) => m.marketingPreferencesFormSaveError({}, { locale }),
    success: (locale) => m.marketingPreferencesFormSaved({}, { locale }),
  },
} satisfies Record<
  MarketingFeedbackKind,
  Record<MarketingFeedback["outcome"], FeedbackMessage>
>;

const getMarketingFeedbackMessage = (
  { kind, outcome, reason }: MarketingFeedback,
  locale: Locale
) =>
  (reason
    ? rejectionReasonMessages[reason]
    : actionOutcomeMessages[kind][outcome])(locale);

const titleId = "marketing-preferences-title";
const descriptionId = "marketing-preferences-description";
const switchId = "marketing-preferences-switch";
const feedbackId = "marketing-preferences-feedback";

function MarketingPreferencesFormContent({
  locale,
  state,
}: {
  readonly locale: Locale;
  readonly state: MarketingPreferencesState;
}) {
  const formContext = getMarketingPreferencesFormContext(state);
  const {
    busy,
    checked,
    clearManagement,
    continueManagement,
    feedback,
    handleToggle,
    isClearing,
    isConfirming,
    isSaving,
  } = useMarketingPreferencesActions({
    formContext,
    locale,
    status: state.status,
  });
  const source = formContext.managedState?.source;

  // Live-region feedback rendered inside the active surface: the managed
  // row's support column, or the fallback state's root — never as a loose
  // sibling that would break the row-group card rhythm. Both regions stay
  // mounted so assistive technology observes their content changes.
  const feedbackBlock = formContext.hasContextState ? (
    <MarketingPreferencesFeedback
      feedback={feedback}
      isSaving={isSaving}
      locale={locale}
    />
  ) : null;

  if (state.status === "unavailable") {
    return (
      <div
        className="min-w-0"
        data-marketing-preferences={state.status}
        data-marketing-preferences-source={source}
      >
        <UnavailableState locale={locale} />
      </div>
    );
  }

  if (state.status === "invalid-link") {
    return (
      <div
        className="min-w-0 space-y-3"
        data-marketing-preferences={state.status}
        data-marketing-preferences-source={source}
      >
        <InvalidLinkState
          isClearing={isClearing}
          locale={locale}
          onClear={clearManagement}
        />
        {feedbackBlock}
      </div>
    );
  }

  if (formContext.pendingState) {
    return (
      <div
        className="min-w-0 space-y-3"
        data-marketing-preferences={state.status}
        data-marketing-preferences-source={source}
      >
        <PendingLinkState
          busy={busy}
          isClearing={isClearing}
          isConfirming={isConfirming}
          locale={locale}
          onClear={clearManagement}
          onContinue={continueManagement}
        />
        {feedbackBlock}
      </div>
    );
  }

  return (
    <PreferenceRow
      busy={isSaving}
      control={
        <Switch
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          checked={checked}
          className="shrink-0"
          disabled={busy}
          id={switchId}
          onCheckedChange={handleToggle}
        />
      }
      data-marketing-preferences={state.status}
      data-marketing-preferences-source={source}
      description={m.marketingPreferencesFormRowDescription({}, { locale })}
      descriptionId={descriptionId}
      headingAs="h3"
      title={m.marketingPreferencesFormRowTitle({}, { locale })}
      titleId={titleId}
    >
      {formContext.isLinkManagement && (
        <LinkManagementControls
          busy={busy}
          isClearing={isClearing}
          locale={locale}
          onClear={clearManagement}
        />
      )}
      {feedbackBlock}
    </PreferenceRow>
  );
}

function MarketingPreferencesFeedback({
  feedback,
  isSaving,
  locale,
}: {
  readonly feedback: MarketingFeedback | null;
  readonly isSaving: boolean;
  readonly locale: Locale;
}) {
  const hasError = feedback?.outcome === "error";

  return (
    <div className="text-sm" id={feedbackId}>
      <div aria-live="polite" role="status">
        {isSaving && (
          <p>{m.marketingPreferencesFormSavingStatus({}, { locale })}</p>
        )}
        {feedback && !hasError && (
          <p className="text-emerald-800">
            {getMarketingFeedbackMessage(feedback, locale)}
          </p>
        )}
      </div>
      <div role="alert">
        {feedback && hasError && (
          <p className="text-red-700">
            {getMarketingFeedbackMessage(feedback, locale)}
          </p>
        )}
      </div>
    </div>
  );
}

function LinkManagementControls({
  busy,
  isClearing,
  locale,
  onClear,
}: {
  readonly busy: boolean;
  readonly isClearing: boolean;
  readonly locale: Locale;
  readonly onClear: () => void;
}) {
  return (
    <>
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {m.marketingPreferencesFormLinkContext({}, { locale })}
      </p>
      <Button
        className="self-start"
        disabled={busy}
        onClick={onClear}
        pending={isClearing}
        type="button"
        variant="secondary"
        wrap
      >
        {isClearing
          ? m.marketingPreferencesFormClearing({}, { locale })
          : m.marketingPreferencesFormClearAction({}, { locale })}
      </Button>
    </>
  );
}

function PendingLinkState({
  busy,
  isClearing,
  isConfirming,
  locale,
  onClear,
  onContinue,
}: {
  readonly busy: boolean;
  readonly isClearing: boolean;
  readonly isConfirming: boolean;
  readonly locale: Locale;
  readonly onClear: () => void;
  readonly onContinue: () => void;
}) {
  return (
    <div className="min-w-0 space-y-3">
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {m.marketingPreferencesFormPendingDescription({}, { locale })}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button
          disabled={busy}
          onClick={onContinue}
          pending={isConfirming}
          type="button"
          wrap
        >
          {isConfirming
            ? m.marketingPreferencesFormConfirming({}, { locale })
            : m.marketingPreferencesFormContinueAction({}, { locale })}
        </Button>
        <Button
          disabled={busy}
          onClick={onClear}
          pending={isClearing}
          type="button"
          variant="secondary"
          wrap
        >
          {isClearing
            ? m.marketingPreferencesFormClearing({}, { locale })
            : m.marketingPreferencesFormClearAction({}, { locale })}
        </Button>
      </div>
    </div>
  );
}

function UnavailableState({ locale }: { readonly locale: Locale }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {m.marketingPreferencesFormUnavailableDescription({}, { locale })}
      </p>
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {m.marketingPreferencesFormUnavailableNextStep({}, { locale })}
      </p>
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {m.marketingPreferencesFormUnavailableSignInNextStep({}, { locale })}
      </p>
      <a
        className="inline-flex max-w-full wrap-break-word pt-1 text-sm font-semibold text-burned-orange underline decoration-burned-orange/40 underline-offset-4 hover:text-burned-orange-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2"
        href={getAccountSignInPath(locale)}
      >
        {m.marketingPreferencesFormSignInAction({}, { locale })}
      </a>
    </div>
  );
}

function InvalidLinkState({
  isClearing,
  locale,
  onClear,
}: {
  readonly isClearing: boolean;
  readonly locale: Locale;
  readonly onClear: () => void;
}) {
  return (
    <div className="min-w-0 space-y-3">
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {m.marketingPreferencesFormInvalidLinkDescription({}, { locale })}
      </p>
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {m.marketingPreferencesFormInvalidLinkNextStep({}, { locale })}
      </p>
      <Button
        onClick={onClear}
        pending={isClearing}
        type="button"
        variant="secondary"
        wrap
      >
        {isClearing
          ? m.marketingPreferencesFormClearing({}, { locale })
          : m.marketingPreferencesFormClearAction({}, { locale })}
      </Button>
    </div>
  );
}
