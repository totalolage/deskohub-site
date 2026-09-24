"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import {
  clearMarketingManagementAction,
  confirmMarketingManagementAction,
  saveMarketingPreferencesAction,
} from "@/features/legal/actions";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";
import { Button } from "@/shared/components/ui/button";
import { PreferenceRow } from "@/shared/components/ui/preference-row";
import { Switch } from "@/shared/components/ui/switch";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

export interface MarketingPreferencesFormProps {
  readonly accountsEnabled?: boolean;
  readonly locale: Locale;
  readonly state: MarketingPreferencesState;
}

export function MarketingPreferencesForm({
  accountsEnabled = true,
  locale,
  state,
}: MarketingPreferencesFormProps) {
  return (
    <MarketingPreferencesFormContent
      accountsEnabled={accountsEnabled}
      key={`${state.status}:${"source" in state ? state.source : "none"}:${"context" in state ? state.context : "none"}:${"dismissalContext" in state ? state.dismissalContext : "none"}`}
      locale={locale}
      state={state}
    />
  );
}

type MarketingFeedbackKind = "save" | "confirm" | "clear";

type MarketingFeedback = {
  readonly kind: MarketingFeedbackKind;
  readonly outcome: "success" | "error";
  readonly serverMessage?: string;
};

function MarketingPreferencesFormContent({
  accountsEnabled,
  locale,
  state,
}: {
  readonly accountsEnabled: boolean;
  readonly locale: Locale;
  readonly state: MarketingPreferencesState;
}) {
  const router = useRouter();
  const managedState =
    state.status === "absent" ||
    state.status === "active" ||
    state.status === "withdrawn"
      ? state
      : undefined;
  const pendingState = state.status === "pending-link" ? state : undefined;
  const context = "context" in state ? state.context : undefined;
  const dismissalContext =
    "dismissalContext" in state ? state.dismissalContext : undefined;
  const source = managedState?.source;
  const isLinkManagement = source === "link";

  // The switch is optimistic: it moves to the target state immediately on
  // toggle and reverts to the server-authoritative state only when the save
  // fails.
  const [checked, setChecked] = useState(managedState?.status === "active");
  const [feedback, setFeedback] = useState<MarketingFeedback | null>(null);
  // The last value the server confirmed. Refreshed server props may lag behind
  // a successful save, so failures must revert to this, not to the initial
  // (possibly stale) props.
  const [confirmedActive, setConfirmedActive] = useState(
    managedState?.status === "active"
  );

  const markSuccess = (kind: MarketingFeedbackKind) => {
    setFeedback({ kind, outcome: "success" });
    router.refresh();
  };
  const markError = (kind: MarketingFeedbackKind, serverMessage?: string) =>
    setFeedback({ kind, outcome: "error", serverMessage });

  const revertToConfirmed = () => setChecked(confirmedActive);

  const { execute: executeSave, isExecuting: isSaving } = useWorkspaceAction(
    saveMarketingPreferencesAction,
    {
      actionName: "legal.marketing-preferences.save",
      onSuccess: ({ input }) => {
        setConfirmedActive(input.granted);
        markSuccess("save");
      },
      onError: ({ error }) => {
        revertToConfirmed();
        markError("save", error.serverError);
      },
      onTransportError: () => {
        revertToConfirmed();
        markError("save");
      },
    }
  );
  const { execute: executeConfirm, isExecuting: isConfirming } =
    useWorkspaceAction(confirmMarketingManagementAction, {
      actionName: "legal.marketing-preferences.confirm",
      onSuccess: () => markSuccess("confirm"),
      onError: ({ error }) => markError("confirm", error.serverError),
      onTransportError: () => markError("confirm"),
    });
  const { execute: executeClear, isExecuting: isClearing } = useWorkspaceAction(
    clearMarketingManagementAction,
    {
      actionName: "legal.marketing-preferences.clear",
      onSuccess: () => markSuccess("clear"),
      onError: ({ error }) => markError("clear", error.serverError),
      onTransportError: () => markError("clear"),
    }
  );

  const busy = isSaving || isConfirming || isClearing;
  const actionInFlight = useRef(false);

  useEffect(() => {
    if (!busy) actionInFlight.current = false;
  }, [busy]);

  const titleId = "marketing-preferences-title";
  const descriptionId = "marketing-preferences-description";
  const switchId = "marketing-preferences-switch";
  const feedbackId = "marketing-preferences-feedback";
  const hasContextState =
    context !== undefined || dismissalContext !== undefined;
  const hasError = feedback?.outcome === "error";

  function feedbackMessage(
    kind: MarketingFeedbackKind,
    outcome: "success" | "error"
  ) {
    if (kind === "save") {
      return outcome === "success"
        ? m.marketingPreferencesFormSaved({}, { locale })
        : m.marketingPreferencesFormSaveError({}, { locale });
    }
    if (kind === "confirm") {
      return outcome === "success"
        ? m.marketingPreferencesFormConfirmed({}, { locale })
        : m.marketingPreferencesFormConfirmError({}, { locale });
    }
    return outcome === "success"
      ? m.marketingPreferencesFormCleared({}, { locale })
      : m.marketingPreferencesFormClearError({}, { locale });
  }

  return (
    <section
      aria-labelledby={managedState ? titleId : undefined}
      className="min-w-0"
      data-marketing-preferences={state.status}
      data-marketing-preferences-source={source}
    >
      {state.status === "unavailable" && (
        <UnavailableState accountsEnabled={accountsEnabled} locale={locale} />
      )}
      {state.status === "invalid-link" && (
        <InvalidLinkState
          isClearing={isClearing}
          locale={locale}
          onClear={clearManagement}
        />
      )}
      {pendingState && (
        <PendingLinkState
          busy={busy}
          isClearing={isClearing}
          isConfirming={isConfirming}
          locale={locale}
          onClear={clearManagement}
          onContinue={continueManagement}
        />
      )}
      {managedState && (
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
          description={m.marketingPreferencesFormRowDescription({}, { locale })}
          descriptionId={descriptionId}
          headingAs="h3"
          title={m.marketingPreferencesFormRowTitle({}, { locale })}
          titleId={titleId}
        >
          {isLinkManagement && (
            <>
              <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
                {m.marketingPreferencesFormLinkContext({}, { locale })}
              </p>
              <Button
                aria-busy={isClearing}
                className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal! self-start px-4 py-2 leading-5"
                disabled={busy}
                onClick={clearManagement}
                type="button"
                variant="secondary"
              >
                {isClearing
                  ? m.marketingPreferencesFormClearing({}, { locale })
                  : m.marketingPreferencesFormClearAction({}, { locale })}
              </Button>
            </>
          )}
        </PreferenceRow>
      )}

      {hasContextState && (
        <div
          aria-live={feedback ? "polite" : undefined}
          className="mt-3 min-h-5 text-sm"
          id={feedbackId}
          role={hasError ? "alert" : undefined}
        >
          {isSaving && (
            <p role="status">
              {m.marketingPreferencesFormSavingStatus({}, { locale })}
            </p>
          )}
          {feedback && (
            <p className={hasError ? "text-red-700" : "text-emerald-800"}>
              {feedback.serverMessage ??
                feedbackMessage(feedback.kind, feedback.outcome)}
            </p>
          )}
        </div>
      )}
    </section>
  );

  function handleToggle(nextChecked: boolean) {
    if (
      managedState === undefined ||
      context === undefined ||
      busy ||
      actionInFlight.current ||
      nextChecked === checked
    ) {
      return;
    }

    actionInFlight.current = true;
    setFeedback(null);
    setChecked(nextChecked);
    executeSave({
      confirmed: true,
      context,
      granted: nextChecked,
      locale,
      source: managedState.source,
    });
  }

  function continueManagement() {
    if (
      pendingState === undefined ||
      context === undefined ||
      busy ||
      actionInFlight.current
    ) {
      return;
    }

    actionInFlight.current = true;
    setFeedback(null);
    executeConfirm({ context });
  }

  function clearManagement() {
    if (
      dismissalContext === undefined ||
      (!isLinkManagement &&
        pendingState === undefined &&
        state.status !== "invalid-link") ||
      busy ||
      actionInFlight.current
    ) {
      return;
    }

    actionInFlight.current = true;
    setFeedback(null);
    executeClear({ context: dismissalContext });
  }
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
          aria-busy={isConfirming}
          className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal px-4 py-2 text-left leading-5 sm:text-center"
          disabled={busy}
          onClick={onContinue}
          type="button"
        >
          {isConfirming
            ? m.marketingPreferencesFormConfirming({}, { locale })
            : m.marketingPreferencesFormContinueAction({}, { locale })}
        </Button>
        <Button
          aria-busy={isClearing}
          className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal! px-4 py-2 text-left leading-5 sm:text-center"
          disabled={busy}
          onClick={onClear}
          type="button"
          variant="secondary"
        >
          {isClearing
            ? m.marketingPreferencesFormClearing({}, { locale })
            : m.marketingPreferencesFormClearAction({}, { locale })}
        </Button>
      </div>
    </div>
  );
}

function UnavailableState({
  accountsEnabled,
  locale,
}: {
  readonly accountsEnabled: boolean;
  readonly locale: Locale;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {m.marketingPreferencesFormUnavailableDescription({}, { locale })}
      </p>
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {m.marketingPreferencesFormUnavailableNextStep({}, { locale })}
      </p>
      {accountsEnabled && (
        <>
          <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
            {m.marketingPreferencesFormUnavailableSignInNextStep(
              {},
              { locale }
            )}
          </p>
          <a
            className="inline-flex max-w-full wrap-break-word pt-1 text-sm font-semibold text-burned-orange underline decoration-burned-orange/40 underline-offset-4 hover:text-burned-orange-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2"
            href={`/${locale}/auth/sign-in`}
          >
            {m.marketingPreferencesFormSignInAction({}, { locale })}
          </a>
        </>
      )}
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
        aria-busy={isClearing}
        className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal! px-4 py-2 text-left leading-5 sm:text-center"
        disabled={isClearing}
        onClick={onClear}
        type="button"
        variant="secondary"
      >
        {isClearing
          ? m.marketingPreferencesFormClearing({}, { locale })
          : m.marketingPreferencesFormClearAction({}, { locale })}
      </Button>
    </div>
  );
}
