import type { CustomerAgentConnection } from "@deskohub/workspace-customer-api";
import { Cause, Effect, Option, Predicate } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import {
  CustomerApi,
  CustomerAuthApi,
} from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import {
  customerRead,
  customerWrite,
  refreshAfterWrite,
} from "../../customer-api/customer-request";
import type {
  CustomerRequestFailure,
  CustomerViewError,
} from "../../customer-api/customer-view-error";
import type { AppLocale } from "../../i18n/app-locale";
import { formatInstant, parseInstant } from "../../i18n/date-time-format";

/**
 * The AI assistants the customer let use their account (GET
 * /account/assistant-connections). It needs only the session, so it reads no
 * Dotypos and works without a linked profile.
 */
export const assistantConnectionsAtom = customerDataRuntime.atom(
  Effect.flatMap(Effect.service(CustomerApi), (api) =>
    api.account.listAssistantConnections()
  ).pipe(customerRead({ accountRead: false }))
);

/**
 * The connections disconnected while the screen is open. Their rows go at
 * once, before the list read after the disconnect arrives.
 */
const noneDisconnected: ReadonlySet<string> = new Set();
export const disconnectedAssistantsAtom = Atom.make(noneDisconnected);

// Better Auth answers 404 when the consent no longer exists, e.g. the
// assistant was disconnected on another device: what the customer asked for
// already holds.
const isAlreadyDisconnected = (error: unknown) =>
  Predicate.isTagged(error, "CustomerAuthRejected") &&
  Predicate.hasProperty(error, "reason") &&
  error.reason === "not-found";

/**
 * Disconnects one assistant (Better Auth's POST /oauth2/delete-consent, which
 * needs a session but not a fresh one) by its consent id, and reads the list
 * again once the server may have changed it.
 */
export const disconnectAssistantAtom = customerDataRuntime.fn(
  (id: string, get) =>
    Effect.flatMap(Effect.service(CustomerAuthApi), (client) =>
      client.auth.deleteConsent({ payload: { id } })
    ).pipe(
      customerWrite,
      Effect.catchIf(isAlreadyDisconnected, () => Effect.void),
      Effect.tap(() =>
        Effect.sync(() =>
          get.registry.update(
            disconnectedAssistantsAtom,
            (ids) => new Set([...ids, id])
          )
        )
      ),
      refreshAfterWrite(get, [assistantConnectionsAtom]),
      Effect.asVoid
    )
);

/**
 * Whether a failed read of the list is the "couldn't be loaded" state: the
 * server couldn't read it, or no answer came in time. Both can be tried
 * again.
 */
export const isAssistantsUnavailable = (error: CustomerViewError) =>
  error._tag === "Unavailable" || error._tag === "TimedOut";

/** The granted scopes the app can explain, in the consent page's order. */
export const assistantScopes = [
  "offerings:read",
  "reservations:read",
  "reservations:create",
  "offline_access",
] as const;

export type AssistantScope = (typeof assistantScopes)[number];

const isAssistantScope = (scope: string): scope is AssistantScope =>
  (assistantScopes as ReadonlyArray<string>).includes(scope);

/** One connected assistant as its row shows it. */
export interface AssistantRow {
  readonly id: string;
  /** The assistant's own name; absent when its metadata gives none. */
  readonly name: string | undefined;
  /** Where it comes from and when it was connected. */
  readonly details:
    | { readonly kind: "host"; readonly host: string; readonly date: string }
    | { readonly kind: "date"; readonly date: string }
    /** The connection time couldn't be read. */
    | { readonly kind: "none" };
  /**
   * What it may do, in the API's order. The Workspace lists only the scopes
   * its consent page explains; one this app doesn't know comes from a newer
   * Workspace than the app and has no wording here, so it is left out rather
   * than shown as a raw token.
   */
  readonly scopes: ReadonlyArray<AssistantScope>;
  /** Whether it may also use the administration. */
  readonly administration: boolean;
}

const rowDetails = (
  connection: CustomerAgentConnection,
  locale: AppLocale
): AssistantRow["details"] =>
  Option.match(parseInstant(connection.connectedAt), {
    onNone: () => ({ kind: "none" }) as const,
    onSome: (instant) => {
      const date = formatInstant(instant, locale, "date");
      return connection.host === undefined
        ? ({ kind: "date", date } as const)
        : ({ kind: "host", host: connection.host, date } as const);
    },
  });

/** The row of one connection. */
export const assistantRow = (
  connection: CustomerAgentConnection,
  locale: AppLocale
): AssistantRow => ({
  id: connection.id,
  name: connection.name,
  details: rowDetails(connection, locale),
  scopes: connection.scopes.filter(isAssistantScope),
  administration: connection.administration,
});

/** The rows the screen shows: the list read, without those just disconnected. */
export const assistantRows = (
  connections: ReadonlyArray<CustomerAgentConnection>,
  disconnected: ReadonlySet<string>,
  locale: AppLocale
): ReadonlyArray<AssistantRow> =>
  connections
    .filter((connection) => !disconnected.has(connection.id))
    .map((connection) => assistantRow(connection, locale));

/** The assistant the customer is asked to confirm disconnecting. */
export interface DisconnectTarget {
  readonly id: string;
  readonly name: string | undefined;
}

/** What the screen shows about the latest disconnect. */
export interface DisconnectView {
  /** Whether the confirmation stays open. */
  readonly dialogOpen: boolean;
  readonly busy: boolean;
  /** The last attempt failed and nothing changed; it can be tried again. */
  readonly failed: boolean;
  /** Announced on the screen once the dialog has closed. */
  readonly outcome: "disconnected" | "unconfirmed" | undefined;
}

const isUnconfirmed = (cause: Cause.Cause<CustomerRequestFailure>) =>
  Option.exists(Cause.findErrorOption(cause), (error) =>
    Predicate.isTagged(error, "CustomerWriteUnconfirmed")
  );

/**
 * The disconnect's state for the screen. A success closes the confirmation
 * and is announced; an unconfirmed attempt closes it too, so the list read
 * again shows what the server holds; any other failure keeps it open with
 * the error, to try again.
 */
export const disconnectView = ({
  target,
  result,
}: {
  readonly target: DisconnectTarget | undefined;
  readonly result: AsyncResult.AsyncResult<void, CustomerRequestFailure>;
}): DisconnectView => {
  const unconfirmed =
    AsyncResult.isFailure(result) && isUnconfirmed(result.cause);
  const succeeded = AsyncResult.isSuccess(result);
  const settled = !result.waiting && (succeeded || unconfirmed);
  const settledOutcome = succeeded ? "disconnected" : "unconfirmed";
  return {
    dialogOpen: target !== undefined && !settled,
    busy: result.waiting,
    // No reauthentication here: Better Auth's delete-consent needs a session,
    // not a fresh one, so it never answers SESSION_NOT_FRESH.
    failed: !result.waiting && AsyncResult.isFailure(result) && !unconfirmed,
    outcome: settled ? settledOutcome : undefined,
  };
};
