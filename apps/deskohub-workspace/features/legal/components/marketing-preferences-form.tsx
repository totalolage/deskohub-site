"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { Locale } from "@/features/i18n";
import {
  clearMarketingManagementAction,
  confirmMarketingManagementAction,
  saveMarketingPreferencesAction,
} from "@/features/legal/actions";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Label } from "@/shared/components/ui/label";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import {
  type MarketingPreferencesFormCopy,
  marketingPreferencesFormCopy,
} from "./marketing-preferences-form.copy";

export interface MarketingPreferencesFormProps {
  readonly accountsEnabled?: boolean;
  readonly locale: Locale;
  readonly state: MarketingPreferencesState;
  readonly copy?: MarketingPreferencesFormCopy;
}

type ManagedMarketingPreferencesState = Extract<
  MarketingPreferencesState,
  { readonly status: "absent" | "active" | "withdrawn" }
>;

export function MarketingPreferencesForm({
  accountsEnabled = true,
  locale,
  state,
  copy = marketingPreferencesFormCopy[locale],
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
  const [confirmed, setConfirmed] = useState(false);
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmSucceeded, setConfirmSucceeded] = useState(false);
  const [confirmFailed, setConfirmFailed] = useState(false);
  const [clearSucceeded, setClearSucceeded] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);

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
  const granted =
    managedState !== undefined && managedState.status !== "active";
  const isLinkManagement = source === "link";

  const {
    execute: executeSave,
    isExecuting: isSaving,
    reset: resetSave,
    result: saveResult,
  } = useWorkspaceAction(saveMarketingPreferencesAction, {
    actionName: "legal.marketing-preferences.save",
    onSuccess: () => {
      setSaveFailed(false);
      setSaveSucceeded(true);
      router.refresh();
    },
    onError: () => {
      setSaveSucceeded(false);
      setSaveFailed(true);
    },
    onTransportError: () => {
      setSaveSucceeded(false);
      setSaveFailed(true);
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
    setSaveFailed(false);
    setConfirmSucceeded(false);
    setConfirmFailed(false);
    setClearSucceeded(false);
    setClearFailed(false);
  };

  const saveError =
    saveResult.serverError || saveResult.validationErrors || saveFailed;
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
  const statusId = "marketing-preferences-status";
  const feedbackId = "marketing-preferences-feedback";
  const confirmationId = "marketing-preferences-confirmation";
  const checkboxId = "marketing-preferences-confirm";
  const hasContextState =
    context !== undefined || dismissalContext !== undefined;
  const hasFeedback =
    saveFeedback !== null || confirmFeedback !== null || clearFeedback !== null;
  const hasError = Boolean(saveError || confirmError || clearError);

  return (
    <section
      aria-labelledby={titleId}
      className="mt-8 min-w-0 border-t border-[#e5e9ef] pt-6"
      data-marketing-preferences={state.status}
      data-marketing-preferences-source={source}
    >
      <div className="min-w-0 max-w-3xl">
        <h3
          className="break-words text-[18px] font-semibold leading-6 text-[#1f2d43]"
          id={titleId}
        >
          {copy.title}
        </h3>
        <p className="mt-1 break-words text-base leading-6 text-[#586c88]">
          {copy.description}
        </p>

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
          <ManagedPreferenceState
            checkboxId={checkboxId}
            confirmationId={confirmationId}
            copy={copy}
            granted={granted}
            isClearing={isClearing}
            isSaving={isSaving}
            isLinkManagement={isLinkManagement}
            onClear={clearManagement}
            onSubmit={handleSubmit}
            onToggleConfirmation={setConfirmed}
            source={managedState.source}
            statusId={statusId}
            state={managedState}
            confirmed={confirmed}
          />
        )}

        {hasContextState && (
          <div
            aria-live={hasFeedback ? "polite" : undefined}
            className="min-h-5 text-sm"
            id={feedbackId}
            role={hasError ? "alert" : undefined}
          >
            {confirmFeedback && (
              <p className={confirmError ? "text-red-700" : "text-emerald-800"}>
                {confirmFeedback}
              </p>
            )}
            {saveFeedback && (
              <p className={saveError ? "text-red-700" : "text-emerald-800"}>
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
      </div>
    </section>
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      managedState === undefined ||
      context === undefined ||
      !confirmed ||
      busy ||
      actionInFlight.current
    ) {
      return;
    }

    actionInFlight.current = true;
    resetFeedback();
    executeSave({
      confirmed: true,
      context,
      granted,
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

function ManagedPreferenceState({
  checkboxId,
  confirmationId,
  confirmed,
  copy,
  granted,
  isClearing,
  isLinkManagement,
  isSaving,
  onClear,
  onSubmit,
  onToggleConfirmation,
  source,
  state,
  statusId,
}: {
  readonly checkboxId: string;
  readonly confirmationId: string;
  readonly confirmed: boolean;
  readonly copy: MarketingPreferencesFormCopy;
  readonly granted: boolean;
  readonly isClearing: boolean;
  readonly isLinkManagement: boolean;
  readonly isSaving: boolean;
  readonly onClear: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onToggleConfirmation: (confirmed: boolean) => void;
  readonly source: "link" | "account";
  readonly state: ManagedMarketingPreferencesState;
  readonly statusId: string;
}) {
  const statusCopy = {
    absent: copy.statusAbsent,
    active: copy.statusActive,
    withdrawn: copy.statusWithdrawn,
  }[state.status];
  const choice = granted ? "grant" : "withdraw";
  const choiceCopy = {
    grant: {
      confirmation: copy.grantConfirmation,
      action: copy.grantAction,
    },
    withdraw: {
      confirmation: copy.withdrawConfirmation,
      action: copy.withdrawAction,
    },
  }[choice];
  const busy = isSaving || isClearing;

  return (
    <>
      <p
        aria-live="polite"
        className="mt-4 break-words text-sm leading-6 text-[#1f2d43]"
        id={statusId}
        role="status"
      >
        <span className="font-semibold">{statusCopy}</span>
      </p>
      <p className="mt-2 break-words text-sm leading-6 text-[#586c88]">
        {{ link: copy.linkContext, account: copy.accountContext }[source]}
      </p>

      <form
        aria-busy={busy}
        aria-describedby={`${statusId} ${confirmationId}`}
        className="mt-5 min-w-0 space-y-4"
        onSubmit={onSubmit}
      >
        <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-[#dfe4ec] bg-[#f8f6f1] p-4">
          <Checkbox
            aria-describedby={confirmationId}
            checked={confirmed}
            disabled={busy}
            id={checkboxId}
            onCheckedChange={(checked) =>
              onToggleConfirmation(checked === true)
            }
          />
          <Label
            className="cursor-pointer break-words text-sm leading-6 text-[#1f2d43]"
            htmlFor={checkboxId}
            id={confirmationId}
          >
            {choiceCopy.confirmation}
          </Label>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button
            aria-busy={isSaving}
            className="h-auto min-h-11 max-w-full whitespace-normal px-4 py-2 text-left leading-5 sm:text-center"
            disabled={!confirmed || busy}
            type="submit"
          >
            {isSaving && (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            )}
            {isSaving ? copy.saving : choiceCopy.action}
          </Button>
          {isLinkManagement && (
            <Button
              aria-busy={isClearing}
              className="h-auto min-h-11 max-w-full whitespace-normal px-4 py-2 text-left leading-5 sm:text-center"
              disabled={busy}
              onClick={onClear}
              type="button"
              variant="secondary"
            >
              {isClearing && (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              )}
              {isClearing ? copy.clearing : copy.clearAction}
            </Button>
          )}
        </div>
      </form>
    </>
  );
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
    <div className="mt-4 min-w-0 space-y-3">
      <p className="break-words text-sm leading-6 text-[#586c88]">
        {copy.pendingDescription}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button
          aria-busy={isConfirming}
          className="h-auto min-h-11 max-w-full whitespace-normal px-4 py-2 text-left leading-5 sm:text-center"
          disabled={busy}
          onClick={onContinue}
          type="button"
        >
          {isConfirming && (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          )}
          {isConfirming ? copy.confirming : copy.continueAction}
        </Button>
        <Button
          aria-busy={isClearing}
          className="h-auto min-h-11 max-w-full whitespace-normal px-4 py-2 text-left leading-5 sm:text-center"
          disabled={busy}
          onClick={onClear}
          type="button"
          variant="secondary"
        >
          {isClearing && (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          )}
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
    <div className="mt-4 min-w-0 space-y-2">
      <p className="break-words text-sm leading-6 text-[#586c88]">
        {copy.unavailableDescription}
      </p>
      <p className="break-words text-sm leading-6 text-[#586c88]">
        {copy.unavailableNextStep}
      </p>
      {accountsEnabled && (
        <>
          <p className="break-words text-sm leading-6 text-[#586c88]">
            {copy.unavailableSignInNextStep}
          </p>
          <a
            className="inline-flex max-w-full break-words pt-1 text-sm font-semibold text-burned-orange underline decoration-burned-orange/40 underline-offset-4 hover:text-burned-orange-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2"
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
    <div className="mt-4 min-w-0 space-y-3">
      <p className="break-words text-sm leading-6 text-[#586c88]">
        {copy.invalidLinkDescription}
      </p>
      <p className="break-words text-sm leading-6 text-[#586c88]">
        {copy.invalidLinkNextStep}
      </p>
      <Button
        aria-busy={isClearing}
        className="h-auto min-h-11 max-w-full whitespace-normal px-4 py-2 text-left leading-5 sm:text-center"
        disabled={isClearing}
        onClick={onClear}
        type="button"
        variant="secondary"
      >
        {isClearing && (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        )}
        {isClearing ? copy.clearing : copy.clearAction}
      </Button>
    </div>
  );
}
