"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Locale } from "@/features/i18n";
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
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

export type MarketingFeedbackKind = "save" | "confirm" | "clear";

export type MarketingFeedback = {
  readonly kind: MarketingFeedbackKind;
  readonly outcome: "success" | "error";
  readonly reason?: MarketingPreferencesRejectionReason;
};

/**
 * What the form reads from the server state: which management it shows, the
 * contexts its actions send, and the server's consent for the switch.
 */
export const getMarketingPreferencesFormContext = (
  state: MarketingPreferencesState
) => {
  const managedState = isManagedMarketingState(state) ? state : undefined;
  const context = "context" in state ? state.context : undefined;
  const dismissalContext =
    "dismissalContext" in state ? state.dismissalContext : undefined;

  return {
    context,
    dismissalContext,
    hasContextState: context !== undefined || dismissalContext !== undefined,
    isLinkManagement: managedState?.source === "link",
    managedState,
    pendingState: state.status === "pending-link" ? state : undefined,
    serverActive: managedState?.status === "active",
  };
};

type MarketingPreferencesFormContext = ReturnType<
  typeof getMarketingPreferencesFormContext
>;

/**
 * The form's save, continue and clear actions, each single-flight, with the
 * optimistic switch and the feedback they announce.
 */
export const useMarketingPreferencesActions = ({
  formContext: {
    context,
    dismissalContext,
    isLinkManagement,
    managedState,
    pendingState,
    serverActive,
  },
  locale,
  status,
}: {
  readonly formContext: MarketingPreferencesFormContext;
  readonly locale: Locale;
  readonly status: MarketingPreferencesState["status"];
}) => {
  const router = useRouter();
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

  return {
    busy,
    checked,
    clearManagement,
    continueManagement,
    feedback,
    handleToggle,
    isClearing,
    isConfirming,
    isSaving,
  };

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
        status !== "invalid-link") ||
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
};
