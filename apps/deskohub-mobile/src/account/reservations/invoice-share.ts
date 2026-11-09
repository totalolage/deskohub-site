import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { Cause, Data, Effect, Option } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { AccountScopedStorage } from "../../customer-api/account-scoped-storage";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import {
  type CustomerRequestFailure,
  CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import {
  DeviceCapabilityFailed,
  ShareSheet,
} from "../../customer-api/device-capabilities";

/** The name the shared PDF carries; the contract doesn't expose the invoice number. */
export const invoiceFileName = (orderId: CustomerReservationOrderId) =>
  `invoice-${orderId}.pdf`;

const readInvoice = (orderId: CustomerReservationOrderId) =>
  Effect.flatMap(Effect.service(CustomerApi), (api) =>
    api.reservations.getReservationInvoice({ params: { orderId } })
  ).pipe(customerRead({ accountRead: false }));

// The PDF lives until sharing ends; an account exit meanwhile leaves it to
// this share (see `AccountScopedStorage.temporaryFile`).
const temporaryInvoice = (input: {
  readonly name: string;
  readonly bytes: Uint8Array;
}) =>
  Effect.flatMap(Effect.service(AccountScopedStorage), (storage) =>
    storage.temporaryFile(input.name, input.bytes)
  );

// The share sheet can't be called back once open, so an interruption waits
// for it to close rather than removing the file it may still be reading.
const shareFile = (name: string) => (uri: Option.Option<string>) =>
  Option.match(uri, {
    onNone: () => Effect.void,
    onSome: (written) =>
      Effect.flatMap(Effect.service(ShareSheet), (sheet) =>
        sheet.shareFile({ uri: written, name, mimeType: "application/pdf" })
      ).pipe(Effect.uninterruptible),
  });

/**
 * Downloads the order's invoice and hands it to the share sheet (a download
 * on the web), removing the temporary file once sharing ends, however it
 * ends, even after the account exited meanwhile. Nothing is written when the
 * download fails, and nothing is shared after the session ended (the
 * account's storage then writes no file).
 */
export const shareInvoice = (orderId: CustomerReservationOrderId) =>
  Effect.Do.pipe(
    Effect.let("name", () => invoiceFileName(orderId)),
    Effect.bind("bytes", () => readInvoice(orderId)),
    Effect.flatMap(({ name, bytes }) =>
      temporaryInvoice({ name, bytes }).pipe(
        Effect.flatMap(shareFile(name)),
        Effect.scoped
      )
    )
  );

/** The order's invoice share action and its last outcome. */
export const invoiceShareAtom = Atom.family(
  (orderId: CustomerReservationOrderId) =>
    customerDataRuntime.fn(() => shareInvoice(orderId))
);

/** Why sharing the invoice failed, as the status screen explains it. */
export type InvoiceShareFailure = Data.TaggedEnum<{
  /** The invoice couldn't be downloaded. */
  Download: { readonly error: CustomerViewError };
  /** The device couldn't store or share the file. */
  Share: Record<never, never>;
}>;
export const InvoiceShareFailure = Data.taggedEnum<InvoiceShareFailure>();

export const invoiceShareFailureOf = (
  cause: Cause.Cause<CustomerRequestFailure | DeviceCapabilityFailed>
): InvoiceShareFailure =>
  Option.match(Cause.findErrorOption(cause), {
    // A defect or interruption is unexpected, as `viewErrorOf` treats it.
    onNone: () =>
      InvoiceShareFailure.Download({ error: CustomerViewError.Unexpected() }),
    onSome: (error) =>
      error instanceof DeviceCapabilityFailed
        ? InvoiceShareFailure.Share()
        : InvoiceShareFailure.Download({ error: toCustomerViewError(error) }),
  });
