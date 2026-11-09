import { describe, expect, test } from "bun:test";
import type {
  CustomerReservationHistory,
  CustomerReservationSummary,
} from "@deskohub/workspace-customer-api";
import {
  Cause,
  DateTime,
  Deferred,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import { AsyncResult, type AtomRegistry } from "effect/unstable/reactivity";
import {
  AccountExitFence,
  accountStorageKey,
  makeAccountExitFence,
} from "../../customer-api/account-scoped-storage";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import {
  CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import { customerDataExitCleanup } from "../../customer-api/exit-cleanup";
import {
  makeCustomerDataRegistry,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import {
  type FakeDevice,
  fakeCustomerDataLayer,
  fakeDeviceCapabilities,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import {
  FakeWorkspace,
  fakeWorkspaceOrigin,
} from "../../customer-api/testing/fake-workspace";
import {
  type sampleAccountId,
  sampleWorkspaceData,
} from "../../customer-api/testing/sample-fixtures";
import { reservationsCacheName, SavedReservations } from "./reservations-cache";
import {
  type ReservationsList,
  reservationHistoryAtom,
  reservationsListAtom,
  savedReservationsBeforeAccountAtom,
} from "./reservations-list-state";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

/**
 * A registry over a fake Workspace whose history answers wait for `release`
 * after they arrived (announced on `answered`), as a slow network would.
 * Pass a device and fence to share them with another account.
 */
const setup = async ({
  gated = false,
  workspace = FakeWorkspace.forKind("linked"),
  device = makeFakeDevice(),
  fence = makeAccountExitFence(),
}: {
  readonly gated?: boolean;
  readonly workspace?: FakeWorkspace;
  readonly device?: FakeDevice;
  readonly fence?: ReturnType<typeof makeAccountExitFence>;
} = {}) => {
  const answered = await run(Deferred.make<void>());
  const release = await run(Deferred.make<void>());
  if (!gated) await run(Deferred.succeed(release, undefined));
  const fenceLayer = Layer.succeed(AccountExitFence, fence);
  const base = fakeCustomerDataLayer({
    workspace,
    device,
    fence: fenceLayer,
  });
  const slowHistory = Layer.effect(
    CustomerApi,
    Effect.map(Effect.service(CustomerApi), (api) => ({
      ...api,
      reservations: {
        ...api.reservations,
        // The client's generic signature can't be restated for a wrapper.
        listReservations: ((request) =>
          api.reservations.listReservations(request).pipe(
            Effect.tap(() => Deferred.succeed(answered, undefined)),
            Effect.tap(() => Deferred.await(release))
          )) as typeof api.reservations.listReservations,
      },
    }))
  ).pipe(Layer.provide(base));
  const registry = makeCustomerDataRegistry(Layer.merge(base, slowHistory));
  const cacheKey = accountStorageKey(reservationsCacheName, {
    apiOrigin: fakeWorkspaceOrigin,
    accountId: workspace.data.accountId,
  });
  /** Stores a saved history as an earlier visit would have. */
  const seedSaved = (
    history: CustomerReservationHistory,
    savedAt = Date.now()
  ) =>
    device.storage.set(
      cacheKey,
      Schema.encodeSync(Schema.fromJsonString(SavedReservations))({
        savedAt: DateTime.makeUnsafe(savedAt),
        history,
      })
    );
  const exit = () =>
    run(
      customerDataExitCleanup({
        scope: "account",
        accountId: workspace.data.accountId,
        sessionStartedAt: 0,
      }).pipe(
        Effect.provide(
          Layer.merge(
            fakeDeviceCapabilities(device),
            Layer.succeed(AccountExitFence, fence)
          )
        )
      )
    );
  return {
    workspace,
    device,
    registry,
    cacheKey,
    seedSaved,
    exit,
    answered: () => run(Deferred.await(answered)),
    release: () => run(Deferred.succeed(release, undefined)),
  };
};

const savedRow: CustomerReservationSummary = {
  id: "saved-only",
  product: { kind: "office" },
  startsAt: "2026-01-05T08:00:00Z",
  endsAt: "2026-01-05T16:00:00Z",
  seats: 2,
  status: "confirmed",
};
const savedHistory: CustomerReservationHistory = {
  current: [],
  past: [savedRow],
  unavailable: [],
};

const shownIds = (list: ReservationsList) => [
  ...Option.toArray(list.groups.featured).map((row) => row.id),
  ...list.groups.moreCurrent.map((row) => row.id),
  ...list.groups.past.map((row) => row.id),
  ...list.groups.undated.map((row) => row.id),
];

const shown = (registry: AtomRegistry.AtomRegistry) =>
  AsyncResult.value(registry.get(reservationsListAtom));

const viewErrorOf = (result: AsyncResult.AsyncResult<unknown, unknown>) =>
  AsyncResult.isFailure(result)
    ? Option.map(Cause.findErrorOption(result.cause), (error) =>
        toCustomerViewError(error as never)
      )
    : Option.none();

describe("reservationsListAtom", () => {
  test("shows the fresh history and saves it on this device", async () => {
    const { registry, device, cacheKey, workspace } = await setup();

    const result = await settle(registry, reservationsListAtom);

    expect(result._tag).toBe("Success");
    const list = (result as { success: ReservationsList }).success;
    expect(Option.isNone(list.savedAt)).toBe(true);
    const fresh = sampleWorkspaceData("linked").history;
    expect(shownIds(list)).toEqual(
      [...fresh.current, ...fresh.past, ...fresh.unavailable].map((r) => r.id)
    );
    expect(device.storage.has(cacheKey)).toBe(true);
    expect(workspace.calls).toEqual(["listReservations"]);
  });

  test("shows the saved history first, then replaces it with the fresh one", async () => {
    const context = await setup({ gated: true });
    context.seedSaved(savedHistory);
    const unmount = context.registry.mount(reservationsListAtom);

    await context.answered();
    const first = context.registry.get(reservationsListAtom);
    expect(first._tag).toBe("Success");
    expect(first.waiting).toBe(true);
    const saved = Option.getOrThrow(AsyncResult.value(first));
    expect(Option.isSome(saved.savedAt)).toBe(true);
    expect(shownIds(saved)).toEqual(["saved-only"]);

    await context.release();
    const result = await settle(context.registry, reservationsListAtom);
    unmount();
    const fresh = (result as { success: ReservationsList }).success;
    expect(Option.isNone(fresh.savedAt)).toBe(true);
    expect(shownIds(fresh)).not.toContain("saved-only");
  });

  test("keeps the saved history, marked as saved, when the read fails", async () => {
    const context = await setup();
    context.seedSaved(savedHistory);
    context.workspace.fail("listReservations", "service-unavailable");
    const unmount = context.registry.mount(reservationsListAtom);

    await settle(context.registry, reservationHistoryAtom);
    const result = context.registry.get(reservationsListAtom);
    unmount();

    expect(result._tag).toBe("Failure");
    expect(viewErrorOf(result)).toEqual(
      Option.some(CustomerViewError.Unavailable())
    );
    const list = Option.getOrThrow(AsyncResult.value(result));
    expect(Option.isSome(list.savedAt)).toBe(true);
    expect(shownIds(list)).toEqual(["saved-only"]);
    // The saved history stays for the next visit.
    expect(context.device.storage.has(context.cacheKey)).toBe(true);
  });

  test("fails with the read's error when nothing was saved", async () => {
    const context = await setup();
    context.workspace.fail("listReservations", "service-unavailable");

    const result = await settle(context.registry, reservationsListAtom);

    expect(result._tag).toBe("Failure");
    expect(Option.isNone(shown(context.registry))).toBe(true);
  });

  test("a read answered after the account exited saves nothing", async () => {
    const context = await setup({ gated: true });
    const unmount = context.registry.mount(reservationsListAtom);

    await context.answered();
    await context.exit();
    await context.release();
    await settle(context.registry, reservationHistoryAtom);
    unmount();

    expect(context.workspace.calls).toEqual(["listReservations"]);
    expect(context.device.storage.has(context.cacheKey)).toBe(false);
  });

  test("an unreadable saved entry is dropped and the fresh read shows", async () => {
    const context = await setup({ gated: true });
    context.device.storage.set(context.cacheKey, "{broken");
    const unmount = context.registry.mount(reservationsListAtom);

    await context.answered();
    expect(Option.isNone(shown(context.registry))).toBe(true);
    expect(context.device.storage.has(context.cacheKey)).toBe(false);

    await context.release();
    const result = await settle(context.registry, reservationsListAtom);
    unmount();
    expect(result._tag).toBe("Success");
  });

  test("a saved current reservation that has ended shows as past", async () => {
    const context = await setup({ gated: true });
    const ended = {
      ...savedRow,
      id: "ended-since",
      endsAt: new Date(Date.now() - 60_000).toISOString(),
    };
    context.seedSaved({ current: [ended], past: [], unavailable: [] });
    const unmount = context.registry.mount(reservationsListAtom);

    await context.answered();
    const saved = Option.getOrThrow(shown(context.registry));
    unmount();

    expect(Option.isNone(saved.groups.featured)).toBe(true);
    expect(saved.groups.past.map((row) => row.id)).toEqual(["ended-since"]);
  });

  test("a rate-limited manual refresh keeps the shown list and says so", async () => {
    const context = await setup();
    const unmount = context.registry.mount(reservationsListAtom);
    const first = await settle(context.registry, reservationsListAtom);
    expect(first._tag).toBe("Success");

    context.workspace.fail("listReservations", "rate-limited");
    context.registry.refresh(reservationHistoryAtom);
    await settle(context.registry, reservationHistoryAtom);
    const result = context.registry.get(reservationsListAtom);
    unmount();

    expect(result._tag).toBe("Failure");
    expect(viewErrorOf(result)).toEqual(
      Option.some(CustomerViewError.RateLimited())
    );
    const list = Option.getOrThrow(AsyncResult.value(result));
    expect(Option.isNone(list.savedAt)).toBe(true);
    expect(shownIds(list).length).toBeGreaterThan(0);
    expect(context.workspace.calls).toEqual([
      "listReservations",
      "listReservations",
    ]);
  });

  test("an account that needs linking is read again so the tab's gate follows", async () => {
    const context = await setup();
    const unmountAccount = context.registry.mount(accountAtom);
    await settle(context.registry, accountAtom);
    context.workspace.setAccount(
      sampleWorkspaceData("completion-required").account
    );

    const result = await settle(context.registry, reservationsListAtom);
    await settle(context.registry, accountAtom);
    unmountAccount();

    expect(
      result._tag === "Failure"
        ? toCustomerViewError(result.failure)
        : undefined
    ).toEqual(CustomerViewError.LinkRequired({ reason: "profile-missing" }));
    expect(
      context.workspace.calls.filter((call) => call === "getAccount")
    ).toHaveLength(2);
  });

  test("a saved-only list refreshed after a failure shows the fresh read", async () => {
    const context = await setup();
    context.seedSaved(savedHistory);
    context.workspace.fail("listReservations", "service-unavailable");
    const unmount = context.registry.mount(reservationsListAtom);
    await settle(context.registry, reservationHistoryAtom);
    expect(context.registry.get(reservationsListAtom)._tag).toBe("Failure");

    context.registry.refresh(reservationHistoryAtom);
    const result = await settle(context.registry, reservationsListAtom);
    unmount();

    const fresh = (result as { success: ReservationsList }).success;
    expect(Option.isNone(fresh.savedAt)).toBe(true);
    expect(shownIds(fresh)).not.toContain("saved-only");
  });

  test("another account on the device never sees this account's saved list", async () => {
    const first = await setup();
    await settle(first.registry, reservationsListAtom);
    expect(first.device.storage.has(first.cacheKey)).toBe(true);

    const other = new FakeWorkspace({
      ...sampleWorkspaceData("linked"),
      accountId: "other-account" as typeof sampleAccountId,
    });
    other.fail("listReservations", "service-unavailable");
    const second = await setup({
      workspace: other,
      device: first.device,
      gated: false,
    });
    const result = await settle(second.registry, reservationsListAtom);

    expect(result._tag).toBe("Failure");
    expect(Option.isNone(shown(second.registry))).toBe(true);
  });
});

describe("savedReservationsBeforeAccountAtom", () => {
  test("shows the saved list under the failure when the account can't be read", async () => {
    const context = await setup();
    context.seedSaved(savedHistory);
    context.workspace.fail("getAccount", "service-unavailable");
    const unmount = context.registry.mount(savedReservationsBeforeAccountAtom);

    await settle(context.registry, accountAtom);
    const result = context.registry.get(savedReservationsBeforeAccountAtom);
    unmount();

    expect(result._tag).toBe("Failure");
    expect(viewErrorOf(result)).toEqual(
      Option.some(CustomerViewError.Unavailable())
    );
    const list = Option.getOrThrow(AsyncResult.value(result));
    expect(Option.isSome(list.savedAt)).toBe(true);
    expect(shownIds(list)).toEqual(["saved-only"]);
    expect(context.workspace.calls).toEqual(["getAccount"]);
  });

  test("fails with the account's failure when nothing was saved", async () => {
    const context = await setup();
    context.workspace.fail("getAccount", "service-unavailable");

    const result = await settle(
      context.registry,
      savedReservationsBeforeAccountAtom
    );

    expect(result._tag).toBe("Failure");
    expect(context.workspace.calls).toEqual(["getAccount"]);
  });
});
