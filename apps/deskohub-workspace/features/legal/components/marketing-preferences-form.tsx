"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/features/i18n";
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
import {
  getMarketingPreferencesFormCopy,
  type MarketingPreferencesFormCopy,
} from "./marketing-preferences-form.copy";

export interface MarketingPreferencesFormProps {
  readonly accountsEnabled?: boolean;
  readonly locale: Locale;
  readonly state: MarketingPreferencesState;
  readonly copy?: MarketingPreferencesFormCopy;
}

export function MarketingPreferencesForm({
  accountsEnabled = true,
  locale,
  state,
  copy = getMarketingPreferencesFormCopy(locale),
}: MarketingPreferencesFormProps) {
  return (
    <MarketingPreferencesFormContent
      accountsEnabled={accountsEnabled}
      copy={copy}
      key={`${state.status}:${"source" in state ? state.source : "none"}:${"context" in state ? state.context : "none"}:${"dismissalContext" in state ? state.dismissalContext : "none"}`}
      locale={locale}
      state={state}
    />
  );
}

function MarketingPreferencesFormContent({
  accountsEnabled,
  copy,
  locale,
  state,
}: {
  readonly accountsEnabled: boolean;
  readonly copy: MarketingPreferencesFormCopy;
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

  // The switch is server-authoritative: it reflects the saved consent and
  // only moves after a successful save, so a failure leaves it untouched.
  const [checked, setChecked] = useState(managedState?.status === "active");
  const requestedCheckedRef = useRef(managedState?.status === "active");
  const [saveErrored, setSaveErrored] = useState(false);
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  const [confirmSucceeded, setConfirmSucceeded] = useState(false);
  const [confirmFailed, setConfirmFailed] = useState(false);
  const [clearSucceeded, setClearSucceeded] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);

  const {
    execute: executeSave,
    isExecuting: isSaving,
    reset: resetSave,
    result: saveResult,
  } = useWorkspaceAction(saveMarketingPreferencesAction, {
    actionName: "legal.marketing-preferences.save",
    onSuccess: () => {
      setSaveErrored(false);
      setSaveSucceeded(true);
      setChecked(requestedCheckedRef.current);
      router.refresh();
    },
    onError: () => {
      setSaveSucceeded(false);
      setSaveErrored(true);
    },
    onTransportError: () => {
      setSaveSucceeded(false);
      setSaveErrored(true);
    },
  });
  const {
    execute: executeConfirm,
    isExecuting: isConfirming,
    reset: resetConfirm,
    result: confirmResult,
  } = useWorkspaceAction(confirmMarketingManagementAction, {
    actionName: "legal.marketing-preferences.confirm",
    onSuccess: () => {
      setConfirmFailed(false);
      setConfirmSucceeded(true);
      router.refresh();
    },
    onError: () => {
      setConfirmSucceeded(false);
      setConfirmFailed(true);
    },
    onTransportError: () => {
      setConfirmSucceeded(false);
      setConfirmFailed(true);
    },
  });
  const {
    execute: executeClear,
    isExecuting: isClearing,
    reset: resetClear,
    result: clearResult,
  } = useWorkspaceAction(clearMarketingManagementAction, {
    actionName: "legal.marketing-preferences.clear",
    onSuccess: () => {
      setClearFailed(false);
      setClearSucceeded(true);
      router.refresh();
    },
    onError: () => {
      setClearSucceeded(false);
      setClearFailed(true);
    },
    onTransportError: () => {
      setClearSucceeded(false);
      setClearFailed(true);
    },
  });

  const busy = isSaving || isConfirming || isClearing;
  const actionInFlight = useRef(false);

  useEffect(() => {
    if (!busy) actionInFlight.current = false;
  }, [busy]);

  const resetFeedback = () => {
    resetSave();
    resetConfirm();
    resetClear();
    setSaveSucceeded(false);
    setSaveErrored(false);
    setConfirmSucceeded(false);
    setConfirmFailed(false);
    setClearSucceeded(false);
    setClearFailed(false);
  };

  const saveError =
    saveResult.serverError || saveResult.validationErrors || saveErrored;
  const confirmError =
    confirmResult.serverError ||
    confirmResult.validationErrors ||
    confirmFailed;
  const clearError =
    clearResult.serverError || clearResult.validationErrors || clearFailed;
  let saveFeedback: string | null = null;
  if (saveSucceeded) {
    saveFeedback = copy.saved;
  } else if (saveError) {
    saveFeedback = saveResult.serverError || copy.saveError;
  }
  let confirmFeedback: string | null = null;
  if (confirmSucceeded) {
    confirmFeedback = copy.confirmed;
  } else if (confirmError) {
    confirmFeedback = confirmResult.serverError || copy.confirmError;
  }
  let clearFeedback: string | null = null;
  if (clearSucceeded) {
    clearFeedback = copy.cleared;
  } else if (clearError) {
    clearFeedback = clearResult.serverError || copy.clearError;
  }
  const titleId = "marketing-preferences-title";
  const descriptionId = "marketing-preferences-description";
  const switchId = "marketing-preferences-switch";
  const feedbackId = "marketing-preferences-feedback";
  const hasContextState =
    context !== undefined || dismissalContext !== undefined;
  const hasFeedback =
    saveFeedback !== null || confirmFeedback !== null || clearFeedback !== null;
  const hasError = Boolean(saveError || confirmError || clearError);

  return (
    <section
      aria-labelledby={managedState ? titleId : undefined}
      className="mt-8 min-w-0"
      data-marketing-preferences={state.status}
      data-marketing-preferences-source={source}
    >
      {state.status === "unavailable" && (
        <UnavailableState
          accountsEnabled={accountsEnabled}
          copy={copy}
          locale={locale}
        />
      )}
      {state.status === "invalid-link" && (
        <InvalidLinkState
          copy={copy}
          isClearing={isClearing}
          onClear={clearManagement}
        />
      )}
      {pendingState && (
        <PendingLinkState
          busy={busy}
          copy={copy}
          isClearing={isClearing}
          isConfirming={isConfirming}
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
          description={copy.rowDescription}
          descriptionId={descriptionId}
          headingAs="h3"
          title={copy.rowTitle}
          titleId={titleId}
        >
          {isLinkManagement && (
            <>
              <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
                {copy.linkContext}
              </p>
              <Button
                aria-busy={isClearing}
                className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal! self-start px-4 py-2 leading-5"
                disabled={busy}
                onClick={clearManagement}
                type="button"
                variant="secondary"
              >
                {isClearing ? copy.clearing : copy.clearAction}
              </Button>
            </>
          )}
        </PreferenceRow>
      )}

      {hasContextState && (
        <div
          aria-live={hasFeedback ? "polite" : undefined}
          className="mt-3 min-h-5 text-sm"
          id={feedbackId}
          role={hasError ? "alert" : undefined}
        >
          {isSaving && <p role="status">{copy.savingStatus}</p>}
          {confirmFeedback && (
            <p className={confirmError ? "text-red-700" : "text-emerald-800"}>
              {confirmFeedback}
            </p>
          )}
          {saveFeedback && (
            <p className={saveErrored ? "text-red-700" : "text-emerald-800"}>
              {saveFeedback}
            </p>
          )}
          {clearFeedback && (
            <p className={clearError ? "text-red-700" : "text-emerald-800"}>
              {clearFeedback}
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
    resetFeedback();
    requestedCheckedRef.current = nextChecked;
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
    resetFeedback();
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
    resetFeedback();
    executeClear({ context: dismissalContext });
  }
}

function PendingLinkState({
  busy,
  copy,
  isClearing,
  isConfirming,
  onClear,
  onContinue,
}: {
  readonly busy: boolean;
  readonly copy: MarketingPreferencesFormCopy;
  readonly isClearing: boolean;
  readonly isConfirming: boolean;
  readonly onClear: () => void;
  readonly onContinue: () => void;
}) {
  return (
    <div className="min-w-0 space-y-3">
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {copy.pendingDescription}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button
          aria-busy={isConfirming}
          className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal px-4 py-2 text-left leading-5 sm:text-center"
          disabled={busy}
          onClick={onContinue}
          type="button"
        >
          {isConfirming ? copy.confirming : copy.continueAction}
        </Button>
        <Button
          aria-busy={isClearing}
          className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal! px-4 py-2 text-left leading-5 sm:text-center"
          disabled={busy}
          onClick={onClear}
          type="button"
          variant="secondary"
        >
          {isClearing ? copy.clearing : copy.clearAction}
        </Button>
      </div>
    </div>
  );
}

function UnavailableState({
  accountsEnabled,
  copy,
  locale,
}: {
  readonly accountsEnabled: boolean;
  readonly copy: MarketingPreferencesFormCopy;
  readonly locale: Locale;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {copy.unavailableDescription}
      </p>
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {copy.unavailableNextStep}
      </p>
      {accountsEnabled && (
        <>
          <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
            {copy.unavailableSignInNextStep}
          </p>
          <a
            className="inline-flex max-w-full wrap-break-word pt-1 text-sm font-semibold text-burned-orange underline decoration-burned-orange/40 underline-offset-4 hover:text-burned-orange-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2"
            href={`/${locale}/auth/sign-in`}
          >
            {copy.signInAction}
          </a>
        </>
      )}
    </div>
  );
}

function InvalidLinkState({
  copy,
  isClearing,
  onClear,
}: {
  readonly copy: MarketingPreferencesFormCopy;
  readonly isClearing: boolean;
  readonly onClear: () => void;
}) {
  return (
    <div className="min-w-0 space-y-3">
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {copy.invalidLinkDescription}
      </p>
      <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
        {copy.invalidLinkNextStep}
      </p>
      <Button
        aria-busy={isClearing}
        className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal! px-4 py-2 text-left leading-5 sm:text-center"
        disabled={isClearing}
        onClick={onClear}
        type="button"
        variant="secondary"
      >
        {isClearing ? copy.clearing : copy.clearAction}
      </Button>
    </div>
  );
}
