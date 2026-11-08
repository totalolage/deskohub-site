import { describe, expect, test } from "bun:test";
import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { Effect, Exit, Layer } from "effect";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import {
  DeviceCapabilityFailed,
  ShareSheet,
} from "../../customer-api/device-capabilities";
import {
  type FakeDevice,
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import { sampleOrderIds } from "../../customer-api/testing/sample-fixtures";
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
          Layer.mergeAll(fakeCustomerDataLayer({ workspace, device }), sheet.layer)
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
});
