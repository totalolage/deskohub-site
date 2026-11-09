import { describe, expect, test } from "bun:test";
import type { CustomerAgentConnection } from "@deskohub/workspace-customer-api";
import { Effect, Option } from "effect";
import {
  AsyncResult,
  type Atom,
  AtomRegistry,
} from "effect/unstable/reactivity";
import {
  CustomerViewError,
  isRetryableViewError,
  viewErrorOf,
} from "../../customer-api/customer-view-error";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import { formatInstant, parseInstant } from "../../i18n/date-time-format";
import {
  assistantConnectionsAtom,
  assistantRow,
  assistantRows,
  disconnectAssistantAtom,
  disconnectedAssistantsAtom,
  disconnectView,
  isAssistantsUnavailable,
} from "./connected-assistants";

const connectedAt = "2026-03-04T10:00:00.000Z";
const connectedDate = (locale: "en-US" | "cs-CZ") =>
  formatInstant(Option.getOrThrow(parseInstant(connectedAt)), locale, "date");

const connection = (
  overrides: Partial<CustomerAgentConnection> = {}
): CustomerAgentConnection => ({
  id: "consent-a",
  name: "Synthetic Assistant",
  host: "assistant.example.com",
  scopes: ["reservations:read"],
  administration: false,
  connectedAt,
  ...overrides,
});

const withAssistants = (
  data: ReturnType<typeof makeFakeCustomerData>,
  assistants: ReadonlyArray<CustomerAgentConnection>
) => {
  data.workspace.data = { ...data.workspace.data, assistants };
};

const run = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
) =>
  Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(atom, { suspendOnWaiting: true })(registry)
    )
  );

// Mounts what the screen mounts, so a disconnect's refresh reaches the list.
const openScreen = async (registry: AtomRegistry.AtomRegistry) => {
  const unmount = [
    registry.mount(assistantConnectionsAtom),
    registry.mount(disconnectedAssistantsAtom),
    registry.mount(disconnectAssistantAtom),
  ];
  await run(registry, assistantConnectionsAtom);
  return () => {
    for (const close of unmount) close();
  };
};

// What the screen shows once a disconnect and the list read after it settled.
const disconnect = async (registry: AtomRegistry.AtomRegistry, id: string) => {
  registry.set(disconnectAssistantAtom, id);
  const shownRightAway = registry.get(disconnectedAssistantsAtom);
  const outcome = await run(registry, disconnectAssistantAtom);
  const list = await run(registry, assistantConnectionsAtom);
  return {
    outcome,
    shownRightAway,
    view: disconnectView({
      target: { id, name: undefined },
      result: registry.get(disconnectAssistantAtom),
    }),
    rows: assistantRows(
      list._tag === "Success" ? list.success : [],
      registry.get(disconnectedAssistantsAtom),
      "en-US"
    ),
  };
};

describe("assistantConnectionsAtom", () => {
  test("reads the connections without spending account reads", async () => {
    const data = makeFakeCustomerData("linked");
    withAssistants(data, [connection()]);

    const result = await settle(data.registry, assistantConnectionsAtom);

    expect(result).toMatchObject({
      _tag: "Success",
      success: [{ id: "consent-a" }],
    });
    expect(data.workspace.calls).toEqual(["listAssistantConnections"]);
  });

  test("an empty list is a success with no rows", async () => {
    const data = makeFakeCustomerData("linked");
    withAssistants(data, []);

    const result = await settle(data.registry, assistantConnectionsAtom);

    expect(result).toMatchObject({ _tag: "Success", success: [] });
    expect(
      assistantRows(
        result._tag === "Success" ? result.success : [connection()],
        new Set(),
        "en-US"
      )
    ).toEqual([]);
  });

  test.each(["completion-required", "support-required"] as const)(
    "works for a %s account, which has no usable profile",
    async (kind) => {
      const data = makeFakeCustomerData(kind);
      withAssistants(data, [connection()]);

      const result = await settle(data.registry, assistantConnectionsAtom);

      expect(result).toMatchObject({
        _tag: "Success",
        success: [{ id: "consent-a" }],
      });
      // Only the session-backed list: no account or profile read.
      expect(data.workspace.calls).toEqual(["listAssistantConnections"]);
    }
  );

  test("a list the server couldn't read is the retryable unavailable state", async () => {
    const data = makeFakeCustomerData("linked");
    data.workspace.fail("listAssistantConnections", "service-unavailable");

    const unmount = data.registry.mount(assistantConnectionsAtom);
    await run(data.registry, assistantConnectionsAtom);
    const failed = data.registry.get(assistantConnectionsAtom);
    unmount();

    expect(AsyncResult.isFailure(failed)).toBe(true);
    if (!AsyncResult.isFailure(failed)) return;
    const error = viewErrorOf(failed.cause);
    expect(error._tag).toBe("Unavailable");
    expect(isAssistantsUnavailable(error)).toBe(true);
    expect(isRetryableViewError(error)).toBe(true);
  });

  test("a retry after the unavailable state reads the list again", async () => {
    const data = makeFakeCustomerData("linked");
    withAssistants(data, [connection()]);
    data.workspace.fail("listAssistantConnections", "service-unavailable");
    const close = await openScreen(data.registry);

    data.registry.refresh(assistantConnectionsAtom);
    const retried = await run(data.registry, assistantConnectionsAtom);
    close();

    expect(retried).toMatchObject({ _tag: "Success" });
    expect(data.workspace.calls).toEqual([
      "listAssistantConnections",
      "listAssistantConnections",
    ]);
  });

  test("a read that timed out is the unavailable state too", () => {
    expect(isAssistantsUnavailable(CustomerViewError.TimedOut())).toBe(true);
    expect(isAssistantsUnavailable(CustomerViewError.RateLimited())).toBe(
      false
    );
  });
});

describe("assistantRow", () => {
  test("from a host: the host and the connection date", () => {
    expect(assistantRow(connection(), "cs-CZ").details).toEqual({
      kind: "host",
      host: "assistant.example.com",
      date: connectedDate("cs-CZ"),
    });
  });

  test("without a host: the connection date alone", () => {
    expect(
      assistantRow(connection({ host: undefined }), "en-US").details
    ).toEqual({ kind: "date", date: connectedDate("en-US") });
  });

  test("an unreadable connection time shows no details", () => {
    expect(
      assistantRow(connection({ connectedAt: "not a time" }), "en-US").details
    ).toEqual({ kind: "none" });
  });

  test("an assistant without a name keeps it absent for the fallback", () => {
    expect(assistantRow(connection({ name: undefined }), "en-US").name).toBe(
      undefined
    );
  });

  test("keeps the granted scopes in the API's order and leaves unknown ones out", () => {
    const row = assistantRow(
      connection({
        scopes: [
          "offline_access",
          "reservations:create",
          "booking:write",
          "offerings:read",
          "reservations:read",
        ],
      }),
      "en-US"
    );
    expect(row.scopes).toEqual([
      "offline_access",
      "reservations:create",
      "offerings:read",
      "reservations:read",
    ]);
  });

  test("marks administrator access separately from the scopes", () => {
    const admin = assistantRow(
      connection({ administration: true, scopes: [] }),
      "en-US"
    );
    expect(admin).toMatchObject({ administration: true, scopes: [] });
    expect(assistantRow(connection(), "en-US").administration).toBe(false);
  });
});

describe("disconnectAssistantAtom", () => {
  test("a disconnect removes the row at once and announces it", async () => {
    const data = makeFakeCustomerData("linked");
    withAssistants(data, [
      connection(),
      connection({ id: "consent-b", name: undefined }),
    ]);
    const close = await openScreen(data.registry);

    const { outcome, view, rows } = await disconnect(
      data.registry,
      "consent-a"
    );
    close();

    expect(outcome._tag).toBe("Success");
    expect(view).toEqual({
      dialogOpen: false,
      busy: false,
      failed: false,
      outcome: "disconnected",
    });
    expect(rows.map((row) => row.id)).toEqual(["consent-b"]);
    expect(data.workspace.data.assistants.map(({ id }) => id)).toEqual([
      "consent-b",
    ]);
    expect(data.workspace.calls).toEqual([
      "listAssistantConnections",
      "deleteConsent",
      "listAssistantConnections",
    ]);
  });

  test("the row is hidden before the list read after the disconnect arrives", async () => {
    const data = makeFakeCustomerData("linked");
    withAssistants(data, [connection()]);
    const close = await openScreen(data.registry);
    // The read after the disconnect fails, so only the removal hides the row.
    data.workspace.fail("listAssistantConnections", "service-unavailable");

    data.registry.set(disconnectAssistantAtom, "consent-a");
    await run(data.registry, disconnectAssistantAtom);
    const list = data.registry.get(assistantConnectionsAtom);
    const shown = AsyncResult.value(list);
    close();

    expect(shown._tag).toBe("Some");
    expect(
      assistantRows(
        shown._tag === "Some" ? shown.value : [],
        data.registry.get(disconnectedAssistantsAtom),
        "en-US"
      )
    ).toEqual([]);
  });

  test("a failed disconnect keeps the dialog open to try again", async () => {
    const data = makeFakeCustomerData("linked");
    withAssistants(data, [connection()]);
    const close = await openScreen(data.registry);
    // A refusal: Better Auth answered, and nothing changed.
    data.workspace.fail("deleteConsent", "rate-limited");

    const failed = await disconnect(data.registry, "consent-a");

    expect(failed.view).toEqual({
      dialogOpen: true,
      busy: false,
      failed: true,
      outcome: undefined,
    });
    expect(failed.rows.map((row) => row.id)).toEqual(["consent-a"]);
    // A refused write changed nothing, so the list isn't read again.
    expect(data.workspace.calls).toEqual([
      "listAssistantConnections",
      "deleteConsent",
    ]);

    const retried = await disconnect(data.registry, "consent-a");
    close();

    expect(retried.view.outcome).toBe("disconnected");
    expect(retried.rows).toEqual([]);
  });

  test("an unconfirmed disconnect closes the dialog and shows the server's list", async () => {
    const data = makeFakeCustomerData("linked");
    withAssistants(data, [connection(), connection({ id: "consent-b" })]);
    const close = await openScreen(data.registry);
    // The server disconnects it, then the connection breaks.
    data.workspace.fail("deleteConsent", "transport-failure");

    const { outcome, view, rows } = await disconnect(
      data.registry,
      "consent-a"
    );
    close();

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerWriteUnconfirmed" },
    });
    expect(view).toEqual({
      dialogOpen: false,
      busy: false,
      failed: false,
      outcome: "unconfirmed",
    });
    // Not hidden by the app: the list read again no longer has it.
    expect(data.registry.get(disconnectedAssistantsAtom).size).toBe(0);
    expect(rows.map((row) => row.id)).toEqual(["consent-b"]);
    expect(data.workspace.calls).toEqual([
      "listAssistantConnections",
      "deleteConsent",
      "listAssistantConnections",
    ]);
  });

  test("an assistant already disconnected elsewhere counts as disconnected", async () => {
    const data = makeFakeCustomerData("linked");
    withAssistants(data, [connection()]);
    const close = await openScreen(data.registry);
    // Disconnected on another device after this screen read the list.
    withAssistants(data, []);

    const { outcome, view, rows } = await disconnect(
      data.registry,
      "consent-a"
    );
    close();

    expect(outcome._tag).toBe("Success");
    expect(view.outcome).toBe("disconnected");
    expect(rows).toEqual([]);
    // The list is read again to show what the server holds.
    expect(data.workspace.calls).toEqual([
      "listAssistantConnections",
      "deleteConsent",
      "listAssistantConnections",
    ]);
  });
});

describe("disconnectView", () => {
  test("a confirmation just opened is open and idle", () => {
    expect(
      disconnectView({
        target: { id: "consent-a", name: undefined },
        result: AsyncResult.initial(),
      })
    ).toEqual({
      dialogOpen: true,
      busy: false,
      failed: false,
      outcome: undefined,
    });
  });

  test("while disconnecting, the dialog stays open and busy", () => {
    expect(
      disconnectView({
        target: { id: "consent-a", name: undefined },
        result: AsyncResult.initial(true),
      })
    ).toMatchObject({ dialogOpen: true, busy: true, failed: false });
  });

  test("without a target nothing is open", () => {
    expect(
      disconnectView({ target: undefined, result: AsyncResult.initial() })
        .dialogOpen
    ).toBe(false);
  });
});
