import { describe, expect, test } from "bun:test";
import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { Deferred, Effect, Exit, Fiber, Layer, Option } from "effect";
import {
  AccountExitFence,
  AccountScopedStorage,
  type AccountSession,
  makeAccountExitFence,
} from "../../customer-api/account-scoped-storage";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import {
  DeviceCapabilityFailed,
  ShareSheet,
} from "../../customer-api/device-capabilities";
import { customerDataExitCleanup } from "../../customer-api/exit-cleanup";
import {
  type FakeDevice,
  fakeCustomerDataLayer,
  fakeDeviceCapabilities,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import { sampleOrderIds } from "../../customer-api/testing/sample-fixtures";
import { eventually } from "../../testing/eventually";
import {
  InvoiceShareFailure,
  invoiceFileName,
  invoiceShareFailureOf,
  shareInvoice,
} from "./invoice-share";

// A share sheet that sees the file while it is open, then succeeds or fails.
const observingShareSheet = (device: FakeDevice, fails: boolean) => {
  const filesWhileSharing: Array<number> = [];
  const layer = Layer.succeed(ShareSheet, {
    shareFile: (file) =>
      Effect.suspend(() => {
        filesWhileSharing.push(device.files.size);
        device.sharedFiles.push(file);
        return fails
          ? Effect.fail(new DeviceCapabilityFailed({ capability: "share" }))
          : Effect.void;
      }),
    shareLink: () => Effect.void,
  });
  return { layer, filesWhileSharing };
};

const share = (
  orderId: CustomerReservationOrderId,
  { shareFails = false } = {}
) => {
  const workspace = FakeWorkspace.forKind("linked");
  const device = makeFakeDevice();
  const sheet = observingShareSheet(device, shareFails);
  const exit = Effect.runPromise(
    Effect.exit(
      shareInvoice(orderId).pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeCustomerDataLayer({ workspace, device }),
            sheet.layer
          )
        )
      )
    )
  );
  return exit.then((result) => ({ result, device, workspace, sheet }));
};

describe("shareInvoice", () => {
  test("shares the invoice PDF, then removes the temporary file", async () => {
    const { result, device, sheet } = await share(sampleOrderIds.fulfilled);

    expect(Exit.isSuccess(result)).toBe(true);
    expect(device.sharedFiles).toEqual([
      {
        uri: expect.stringContaining(invoiceFileName(sampleOrderIds.fulfilled)),
        name: invoiceFileName(sampleOrderIds.fulfilled),
        mimeType: "application/pdf",
      },
    ]);
    expect(sheet.filesWhileSharing).toEqual([1]);
    expect(device.files.size).toBe(0);
  });

  test("removes the temporary file when sharing fails", async () => {
    const { result, device, sheet } = await share(sampleOrderIds.fulfilled, {
      shareFails: true,
    });

    expect(sheet.filesWhileSharing).toEqual([1]);
    expect(device.files.size).toBe(0);
    expect(
      Exit.isFailure(result) && invoiceShareFailureOf(result.cause)
    ).toEqual(InvoiceShareFailure.Share());
  });

  test("an invoice not issued yet writes and shares nothing", async () => {
    const { result, device, workspace } = await share(sampleOrderIds.pending);

    expect(workspace.calls).toContain("getReservationInvoice");
    expect(device.files.size).toBe(0);
    expect(device.sharedFiles).toEqual([]);
    expect(
      Exit.isFailure(result) && invoiceShareFailureOf(result.cause)
    ).toEqual(
      InvoiceShareFailure.Download({
        error: CustomerViewError.InvoiceNotIssued(),
      })
    );
  });

  test("an unknown order writes and shares nothing", async () => {
    const { result, device } = await share(
      "sample-order-missing" as CustomerReservationOrderId
    );

    expect(device.files.size).toBe(0);
    expect(device.sharedFiles).toEqual([]);
    expect(
      Exit.isFailure(result) && invoiceShareFailureOf(result.cause)
    ).toEqual(
      InvoiceShareFailure.Download({ error: CustomerViewError.NotFound() })
    );
  });

  test("leaving while the share sheet is open removes the file once it closes", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    const device = makeFakeDevice();

    await Effect.gen(function* () {
      const closed = yield* Deferred.make<void>();
      const sheet = Layer.succeed(ShareSheet, {
        shareFile: (file) =>
          Effect.suspend(() => {
            device.sharedFiles.push(file);
            return Deferred.await(closed);
          }),
        shareLink: () => Effect.void,
      });
      const fiber = yield* shareInvoice(sampleOrderIds.fulfilled).pipe(
        Effect.provide(
          Layer.mergeAll(fakeCustomerDataLayer({ workspace, device }), sheet)
        ),
        Effect.forkChild
      );
      yield* eventually(() => device.sharedFiles.length === 1);

      const interrupted = yield* Effect.forkChild(Fiber.interrupt(fiber));
      yield* Effect.yieldNow;
      // Still open: the file stays for the app the customer shares it with.
      expect(device.files.size).toBe(1);

      yield* Deferred.succeed(closed, undefined);
      yield* Fiber.join(interrupted);
      expect(device.files.size).toBe(0);
    }).pipe(Effect.runPromise);
  });
});

// Share sheets that stay open until the test closes each one.
const openSheets = (device: FakeDevice) => {
  const sheets: Array<{
    readonly uri: string;
    readonly close: Deferred.Deferred<void>;
  }> = [];
  const layer = Layer.succeed(ShareSheet, {
    shareFile: (file) =>
      Effect.flatMap(Deferred.make<void>(), (close) => {
        sheets.push({ uri: file.uri, close });
        device.sharedFiles.push(file);
        return Deferred.await(close);
      }),
    shareLink: () => Effect.void,
  });
  return { sheets, layer };
};

/** One device and exit fence shared by every sign-in and exit of a test. */
const deviceWithSessions = () => {
  const workspace = FakeWorkspace.forKind("linked");
  const device = makeFakeDevice();
  const fence = Layer.succeed(AccountExitFence, makeAccountExitFence());
  const sheet = openSheets(device);
  const signIn = (session: AccountSession) =>
    Layer.mergeAll(
      fakeCustomerDataLayer({ workspace, device, fence, session }),
      sheet.layer
    );
  const accountA = workspace.data.accountId;
  return {
    device,
    /** The `index`th share sheet, once it has opened. */
    sheetOpened: (index: number) =>
      eventually(() => sheet.sheets.length > index).pipe(
        Effect.map(() => sheet.sheets[index]),
        Effect.flatMap(Effect.fromNullishOr)
      ),
    first: { accountId: accountA, sessionStartedAt: 0 },
    again: { accountId: accountA, sessionStartedAt: 1 },
    other: { accountId: `${accountA}-other`, sessionStartedAt: 2 },
    startShare: (session: AccountSession) =>
      shareInvoice(sampleOrderIds.fulfilled).pipe(
        Effect.provide(signIn(session)),
        // Detached: a failed assertion mustn't wait on an open sheet.
        Effect.forkDetach
      ),
    exit: (session: AccountSession) =>
      customerDataExitCleanup({ scope: "account", ...session }).pipe(
        Effect.provide(Layer.merge(fakeDeviceCapabilities(device), fence))
      ),
    storageOf: (session: AccountSession) =>
      Effect.service(AccountScopedStorage).pipe(
        Effect.provide(signIn(session))
      ),
  };
};

describe("shareInvoice across an account exit", () => {
  test("an exit keeps the file an open share sheet holds, which goes once the sheet closes", async () => {
    const setup = deviceWithSessions();

    await Effect.gen(function* () {
      const share = yield* setup.startShare(setup.first);
      const sheet = yield* setup.sheetOpened(0);

      yield* setup.exit(setup.first);
      expect([...setup.device.files.keys()]).toEqual([sheet.uri]);

      yield* Deferred.succeed(sheet.close, undefined);
      yield* Fiber.join(share);
      expect(setup.device.files.size).toBe(0);
    }).pipe(Effect.runPromise);
  });

  test("a share that closes after another account signed in leaves that account nothing", async () => {
    const setup = deviceWithSessions();

    await Effect.gen(function* () {
      const share = yield* setup.startShare(setup.first);
      const sheet = yield* setup.sheetOpened(0);
      yield* setup.exit(setup.first);
      const other = yield* setup.storageOf(setup.other);
      yield* other.setItem("deskohub.reservations.v1", "other account's");

      yield* Deferred.succeed(sheet.close, undefined);
      yield* Fiber.join(share);

      expect(setup.device.files.size).toBe(0);
      expect(yield* other.getItem("deskohub.reservations.v1")).toEqual(
        Option.some("other account's")
      );
    }).pipe(Effect.runPromise);
  });

  test("two shares of the invoice across a quick re-sign-in each remove only their own file", async () => {
    const setup = deviceWithSessions();

    await Effect.gen(function* () {
      const firstShare = yield* setup.startShare(setup.first);
      const first = yield* setup.sheetOpened(0);
      yield* setup.exit(setup.first);
      const secondShare = yield* setup.startShare(setup.again);
      const second = yield* setup.sheetOpened(1);
      expect(first.uri).not.toBe(second.uri);
      expect(setup.device.files.size).toBe(2);

      yield* Deferred.succeed(first.close, undefined);
      yield* Fiber.join(firstShare);
      expect([...setup.device.files.keys()]).toEqual([second.uri]);

      yield* Deferred.succeed(second.close, undefined);
      yield* Fiber.join(secondShare);
      expect(setup.device.files.size).toBe(0);
    }).pipe(Effect.runPromise);
  });
});
