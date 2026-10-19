import { useSyncExternalStore } from "react";
import type { PublishedAgentTool } from "./agent-tool-mcp-client";
import type { SiteToolReservationFormHandle } from "./use-prepare-reservation-site-tool";

/** A value the site tools publish for the document, and its subscribers. */
const createPublishedSlot = <Value>() => {
  let value: Value | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: Value | undefined) => {
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

// The quote tool as the registrar last listed it. Page tools build on its
// published input, and exist only while the registrar's tools do.
const quoteTool = createPublishedSlot<PublishedAgentTool>();

// The reservation form `prepare_reservation` is registered for. A preparation
// that opened another reservation page continues on the form mounted there.
const reservationForm = createPublishedSlot<SiteToolReservationFormHandle>();

export const quoteToolName = "get_quote";

export const publishQuoteTool = quoteTool.set;

/**
 * The published quote tool while the site tools are registered in this
 * document, or `undefined` before then, without the API, or with the release
 * gate off.
 */
export const useQuoteTool = () =>
  useSyncExternalStore(quoteTool.subscribe, quoteTool.get, () => undefined);

/** Publishes the mounted form until the returned function withdraws it. */
export const publishReservationForm = (form: SiteToolReservationFormHandle) => {
  reservationForm.set(form);
  return () => {
    if (reservationForm.get() === form) reservationForm.set(undefined);
  };
};

export const getReservationForm = reservationForm.get;

export const subscribeReservationForm = reservationForm.subscribe;
