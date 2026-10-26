"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { getAccountSignInPath } from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import {
  clearMarketingManagementAction,
  confirmMarketingManagementAction,
  saveMarketingPreferencesAction,
} from "@/features/legal/actions";
import {
  isManagedMarketingState,
  type MarketingPreferencesRejectionReason,
  type MarketingPreferencesState,
} from "@/features/legal/marketing-preferences";
import { Button } from "@/shared/components/ui/button";
import { PreferenceRow } from "@/shared/components/ui/preference-row";
import { Switch } from "@/shared/components/ui/switch";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

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

type MarketingFeedbackKind = "save" | "confirm" | "clear";

type MarketingFeedback = {
  readonly kind: MarketingFeedbackKind;
  readonly outcome: "success" | "error";
  readonly reason?: MarketingPreferencesRejectionReason;
};

function MarketingPreferencesFormContent({
  locale,
  state,
}: {
  readonly locale: Locale;
  readonly state: MarketingPreferencesState;
}) {
  const router = useRouter();
  const managedState = isManagedMarketingState(state) ? state : undefined;
  const pendingState = state.status === "pending-link" ? state : undefined;
  const context = "context" in state ? state.context : undefined;
  const dismissalContext =
    "dismissalContext" in state ? state.dismissalContext : undefined;
  const source = managedState?.source;
  const isLinkManagement = source === "link";

  const serverActive = managedState?.status === "active";
  // The switch is optimistic: it moves to the target state immediately on
  // toggle and reverts to the server-authoritative state only when the save
  // fails.
  const [checked, setChecked] = useState(serverActive);
  const [feedback, setFeedback] = useState<MarketingFeedback | null>(null);
  // The last value the server confirmed. Refreshed server props may lag behind
  // a successful save, so failures must revert to this, not to the initial
  // (possibly stale) props.
  const [confirmedActive, setConfirmedActive] = useState(serverActive);
  // Refreshed props that report a different server status become the new
  // confirmed value; unchanged (lagging) props leave local state alone.
  const [previousServerActive, setPreviousServerActive] =
    useState(serverActive);
  if (serverActive !== previousServerActive) {
    setPreviousServerActive(serverActive);
    setChecked(serverActive);
    setConfirmedActive(serverActive);
  }

  const markSuccess = (kind: MarketingFeedbackKind) => {
    setFeedback({ kind, outcome: "success" });
    router.refresh();
  };
  // A refused request returns its reason as data; announce the reason's copy.
  const markError = (
    kind: MarketingFeedbackKind,
    reason?: MarketingPreferencesRejectionReason
  ) => setFeedback({ kind, outcome: "error", reason });

  const revertToConfirmed = () => setChecked(confirmedActive);

  const { executeAsync: executeSave, isExecuting: isSaving } =
    useWorkspaceAction(saveMarketingPreferencesAction, {
      onSuccess: ({ data, input }) => {
        if (data?.status === "rejected") {
          revertToConfirmed();
          markError("save", data.reason);
          return;
        }
        setConfirmedActive(input.granted);
        markSuccess("save");
      },
      onError: ({ error }) => {
        // Transport failures also arrive through useWorkspaceAction's separate
        // transport callback. Ignore its later hook callback so an older failed
        // request cannot roll back a newer retry.
        if (error.thrownError !== undefined) return;
        revertToConfirmed();
        markError("save");
      },
      onTransportError: () => {
        revertToConfirmed();
        markError("save");
      },
    });
  const { executeAsync: executeConfirm, isExecuting: isConfirming } =
    useWorkspaceAction(confirmMarketingManagementAction, {
      onSuccess: ({ data }) =>
        data?.status === "rejected"
          ? markError("confirm", data.reason)
          : markSuccess("confirm"),
      onError: () => markError("confirm"),
      onTransportError: () => markError("confirm"),
    });
  const { executeAsync: executeClear, isExecuting: isClearing } =
    useWorkspaceAction(clearMarketingManagementAction, {
      onSuccess: ({ data }) =>
        data?.status === "rejected"
          ? markError("clear", data.reason)
          : markSuccess("clear"),
      onError: () => markError("clear"),
      onTransportError: () => markError("clear"),
    });

  const busy = isSaving || isConfirming || isClearing;
  const actionInFlight = useRef(false);
  const releaseActionInFlight = () => {
    actionInFlight.current = false;
  };

  const titleId = "marketing-preferences-title";
  const descriptionId = "marketing-preferences-description";
  const switchId = "marketing-preferences-switch";
  const feedbackId = "marketing-preferences-feedback";
  const hasContextState =
    context !== undefined || dismissalContext !== undefined;
  const hasError = feedback?.outcome === "error";

  function feedbackMessage({ kind, outcome, reason }: MarketingFeedback) {
    if (reason === "invalid-link") {
      return m.marketingPreferencesFormInvalidLinkError({}, { locale });
    }
    if (reason === "stale-context") {
      return m.marketingPreferencesFormStaleContextError({}, { locale });
    }
    if (reason === "pending-confirmation-required") {
      return m.marketingPreferencesFormConfirmationRequiredError(
        {},
        { locale }
      );
    }
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

  // Live-region feedback rendered inside the active surface: the managed
  // row's support column, or the fallback state's root — never as a loose
  // sibling that would break the row-group card rhythm. Both regions stay
  // mounted so assistive technology observes their content changes.
  const feedbackBlock = hasContextState ? (
    <div className="text-sm" id={feedbackId}>
      <div aria-live="polite" role="status">
        {isSaving && (
          <p>{m.marketingPreferencesFormSavingStatus({}, { locale })}</p>
        )}
        {feedback && !hasError && (
          <p className="text-emerald-800">{feedbackMessage(feedback)}</p>
        )}
      </div>
      <div role="alert">
        {feedback && hasError && (
          <p className="text-red-700">{feedbackMessage(feedback)}</p>
        )}
      </div>
    </div>
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

  if (pendingState) {
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
      {isLinkManagement && (
        <>
          <p className="wrap-break-word text-sm leading-6 text-navy-blue/70">
            {m.marketingPreferencesFormLinkContext({}, { locale })}
          </p>
          <Button
            className="self-start"
            disabled={busy}
            onClick={clearManagement}
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
      )}
      {feedbackBlock}
    </PreferenceRow>
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
    void executeSave({
      confirmed: true,
      context,
      granted: nextChecked,
      locale,
      source: managedState.source,
    }).then(releaseActionInFlight, releaseActionInFlight);
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
    void executeConfirm({ context }).then(
      releaseActionInFlight,
      releaseActionInFlight
    );
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
    void executeClear({ context: dismissalContext }).then(
      releaseActionInFlight,
      releaseActionInFlight
    );
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
