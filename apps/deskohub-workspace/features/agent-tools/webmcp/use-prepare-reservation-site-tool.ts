"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/features/i18n";
import type { ReservationFormSubmission } from "@/features/reservation/components/reservation-checkout-form";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { getReservationStartPath } from "@/features/reservation/routes";
import { publishReservationForm, useQuoteTool } from "./site-tool-catalog";
import { getModelContext } from "./webmcp-detection";

/** The mounted reservation form as the `prepare_reservation` tool drives it. */
export type SiteToolReservationForm = {
  readonly kind: ReservationOrderData["kind"];
  readonly locale: Locale;
  readonly asksMarketingConsent: boolean;
  readonly hasMarketingConsent: () => boolean;
  readonly giveMarketingConsent: () => void;
  /** Sets the selection a reservation link names; whether any value changed. */
  readonly applySelection: (searchParams: URLSearchParams) => boolean;
  readonly readiness: {
    /** Availability or the advertised price for the selection is loading. */
    readonly isPending: boolean;
    readonly priceError: boolean;
    readonly unavailableMessage?: string;
  };
  readonly submit: (
    marketingConsentSource: "site_tool" | undefined
  ) => Promise<ReservationFormSubmission>;
};

/** The latest render of the form, and a wait for the next committed one. */
export type SiteToolReservationFormHandle = {
  readonly current: () => SiteToolReservationForm & {
    readonly openReservationPage: (
      kind: ReservationOrderData["kind"],
      searchParams: URLSearchParams
    ) => void;
  };
  readonly onNextCommit: (listener: () => void) => () => void;
};

/**
 * Registers `prepare_reservation` while the reservation form is mounted and
 * the site tools are registered, and publishes the form for a preparation
 * that opened this page from another one. Without WebMCP or with the release gate off,
 * the quote tool is never published and nothing more loads.
 */
export function usePrepareReservationSiteTool(form: SiteToolReservationForm) {
  const router = useRouter();
  const quoteTool = useQuoteTool();
  const latestForm = useRef(form);
  const [commitListeners] = useState(() => new Set<() => void>());
  const [handle] = useState(
    (): SiteToolReservationFormHandle => ({
      current: () => ({
        ...latestForm.current,
        openReservationPage: (kind, searchParams) =>
          router.push(
            getReservationStartPath(
              latestForm.current.locale,
              kind,
              searchParams
            )
          ),
      }),
      onNextCommit: (listener) => {
        commitListeners.add(listener);
        return () => commitListeners.delete(listener);
      },
    })
  );

  // Every commit: the tool reads the form as last rendered, then wakes waits.
  useEffect(() => {
    latestForm.current = form;
    for (const listener of [...commitListeners]) {
      commitListeners.delete(listener);
      listener();
    }
  });

  useEffect(() => {
    const modelContext = quoteTool && getModelContext();
    if (!quoteTool || !modelContext) return;

    const withdrawForm = publishReservationForm(handle);
    const registration = new AbortController();
    void import("./prepare-reservation-site-tool").then(
      ({ registerPrepareReservationSiteTool }) =>
        registerPrepareReservationSiteTool({
          form: handle,
          modelContext,
          quoteTool,
          signal: registration.signal,
        })
    );
    return () => {
      registration.abort();
      withdrawForm();
    };
  }, [handle, quoteTool]);
}
