"use client";

import { useRef, useState } from "react";
import {
  type AresBusinessLookupResult,
  lookupAresBusiness,
} from "@/features/account/actions";
import type { AresBusinessBillingDraft } from "@/features/account/backend/ares-business-draft";
import { type Locale, m } from "@/features/i18n";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

export type AresBusinessLookupState =
  | { readonly status: "idle" }
  | { readonly status: "found"; readonly review: AresBusinessBillingDraft }
  | {
      readonly status: "invalid-ico" | "not-found" | "unavailable" | "applied";
      readonly message: string;
    };

/**
 * Looks up a company in ARES by IČO and holds the result for review before it
 * fills the billing fields. `invalidate` runs on every IČO edit and
 * billing-kind change: it supersedes the lookup in flight, so a response that
 * resolves after the edit is discarded and can never be applied.
 */
export function useAresBusinessLookup(locale: Locale) {
  const [state, setState] = useState<AresBusinessLookupState>({
    status: "idle",
  });
  const isLookupSupersededRef = useRef(false);

  const settle = (outcome: AresBusinessLookupState) => {
    if (!isLookupSupersededRef.current) setState(outcome);
  };

  const action = useWorkspaceAction(lookupAresBusiness, {
    onSuccess: ({ data }) => {
      const result = data as AresBusinessLookupResult | undefined;
      if (!result) return;
      settle(
        result.status === "found"
          ? { status: "found", review: result.company }
          : { status: result.status, message: result.message }
      );
    },
    onError: ({ error }) => {
      // A resolved failure (expired session, pending deletion, disabled
      // accounts, …) must surface in the lookup status instead of silently
      // resetting it.
      settle({
        status: "unavailable",
        message:
          error.serverError || m.accountAresLookupActionError({}, { locale }),
      });
    },
    onTransportError: () => {
      settle({
        status: "unavailable",
        message: m.accountAresLookupActionError({}, { locale }),
      });
    },
  });

  const lookUp = (ico: string) => {
    if (action.isExecuting) return;
    isLookupSupersededRef.current = false;
    setState({ status: "idle" });
    action.execute({ ico });
  };

  const invalidate = () => {
    isLookupSupersededRef.current = true;
    setState({ status: "idle" });
  };

  /** Marks the found company applied and returns it to fill the fields. */
  const apply = (): AresBusinessBillingDraft | undefined => {
    if (state.status !== "found") return undefined;
    setState({
      status: "applied",
      message: m.accountAresLookupApplied({}, { locale }),
    });
    return state.review;
  };

  const dismiss = () => {
    setState({ status: "idle" });
  };

  return {
    state,
    isPending: action.isExecuting,
    lookUp,
    apply,
    dismiss,
    invalidate,
  };
}
