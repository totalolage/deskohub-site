import {
  type AdministrationBookingQueryType,
  AdministrationCanonicalPromotionCode,
  type AdministrationCustomerQueryType,
  type AdministrationDiscountAdjustmentType,
  AdministrationDiscountCodeId,
  type AdministrationDiscountCodeType,
  type AdministrationDiscountDefinitionInputType,
  AdministrationDiscountMutation,
  type AdministrationDiscountMutationResultType,
  type AdministrationDiscountMutationType,
  AdministrationDotyposCustomerId,
  AdministrationDotyposDiscountGroupId,
  AdministrationDotyposReservationId,
  AdministrationInstant,
  AdministrationInvoiceCreateFileInput,
  AdministrationInvoiceId,
  AdministrationInvoiceQuery,
  AdministrationNexiOperationId,
  type AdministrationNexiOperationQueryType,
  AdministrationNexiOrderId,
  type AdministrationNexiOrderQueryType,
  AdministrationOrderId,
  type AdministrationOverviewMetricType,
  type AdministrationReservationAccessGrantType,
  type AdministrationReservationAccessMutationType,
  AdministrationReservationQuery,
  type AdministrationReservationSummaryType,
  AdministrationStoredDiscountId,
  AdministrationVoucherId,
  AdministrationWorkspaceProductTarget,
  type AdministrationWorkspaceProductTargetType,
  AdministrationWorkspaceReservationId,
  type AdministrationWorkspaceReservationIdType,
  type CliAccessTokenType,
  CliClientName,
  CliMutationRequestId,
  CliSessionId,
  type CliSessionType,
  CliSessionUnauthorized,
  makeCliAuthenticationChallenge,
  makeCliAuthenticationVerifier,
} from "@deskohub/workspace-admin-api";
import {
  BigDecimal,
  Console,
  Crypto,
  Data,
  Effect,
  FileSystem,
  Match,
  Option,
  type Redacted,
  Schema,
  SchemaGetter,
} from "effect";
import { Argument, Command, Flag, Prompt } from "effect/unstable/cli";
import { WorkspaceAdminApiClient } from "./api/workspace-admin-api-client.service";
import { AuthenticationService } from "./authentication/authentication.service";
import {
  reportAuthenticationGranted,
  reportAuthenticationStarted,
} from "./authentication/authentication-output";
import { ClientIdentity } from "./authentication/client-identity.service";
import { DHW_BUILD_TARGET, DHW_VERSION, isReleaseBuild } from "./build-info";
import { DhwConfig } from "./config/dhw-config.service";
import { UpdateService } from "./update/update.service";
import type { AvailableUpdate } from "./update/update-state-store.service";

const rootCommand = Command.make("dhw").pipe(
  Command.withSharedFlags({
    json: Flag.boolean("json").pipe(
      Flag.withDescription("Print machine-readable JSON output")
    ),
  }),
  Command.withDescription("Deskohub Workspace administration")
);

const confirmationFlag = Flag.boolean("yes").pipe(
  Flag.withDescription("Apply the change without prompting for confirmation")
);

const versionCommand = Command.make("version", {}, () =>
  runCommand((json) =>
    Console.log(
      json
        ? JSON.stringify({ version: DHW_VERSION, target: DHW_BUILD_TARGET })
        : `dhw ${DHW_VERSION} (${DHW_BUILD_TARGET})`
    )
  )
).pipe(Command.withDescription("Show CLI version and build target"));

const apiInfoCommand = Command.make("info", {}, () =>
  runCommand((json) =>
    Effect.gen(function* () {
      const client = yield* WorkspaceAdminApiClient;
      const info = yield* client.getInfo;

      yield* Console.log(
        json
          ? JSON.stringify(info)
          : `${info.service} administration API ${info.apiVersion}`
      );
    })
  )
).pipe(Command.withDescription("Check the administration API contract"));

const apiCommand = Command.make("api").pipe(
  Command.withDescription("Inspect the administration API"),
  Command.withSubcommands([apiInfoCommand])
);

const overviewCommand = Command.make("overview", {}, () =>
  runAuthenticatedCommand((api, accessToken, json) =>
    Effect.gen(function* () {
      const overview = yield* api.getOverview(accessToken);
      if (json) {
        yield* Console.log(JSON.stringify(overview));
        return;
      }
      yield* Console.log(
        [
          formatOverviewMetric("Today", overview.today),
          formatOverviewMetric("Upcoming", overview.upcoming),
          formatOverviewMetric("Last 7 days", overview.lastSevenDays),
        ].join("\n")
      );
    })
  )
).pipe(Command.withDescription("Show the administration overview"));

const reservationsListCommand = Command.make(
  "list",
  {
    customer: Flag.string("customer").pipe(
      Flag.optional,
      Flag.withDescription("Filter by customer ID")
    ),
    date: Flag.string("date").pipe(
      Flag.optional,
      Flag.withDescription("Filter by reservation date (YYYY-MM-DD)")
    ),
    direction: Flag.choice("direction", ["asc", "desc"]).pipe(
      Flag.optional,
      Flag.withDescription("Sort direction")
    ),
    page: Flag.integer("page").pipe(
      Flag.optional,
      Flag.withDescription("Results page")
    ),
    sort: Flag.choice("sort", [
      "created",
      "date",
      "reservation",
      "status",
    ]).pipe(Flag.optional, Flag.withDescription("Sort field")),
    status: Flag.choice("status", [
      "in_progress",
      "complete",
      "cancelled",
    ]).pipe(Flag.optional, Flag.withDescription("Reservation status")),
    type: Flag.choice("type", ["cowork", "meeting-room", "office"]).pipe(
      Flag.optional,
      Flag.withDescription("Reservation type")
    ),
  },
  ({ customer, date, direction, page, sort, status, type }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const query = yield* Schema.decodeUnknownEffect(
          AdministrationReservationQuery
        )({
          ...(Option.isSome(customer) && { customerId: customer.value }),
          ...(Option.isSome(date) && { date: date.value }),
          ...(Option.isSome(direction) && { direction: direction.value }),
          ...(Option.isSome(page) && { page: page.value }),
          ...(Option.isSome(sort) && { sort: sort.value }),
          ...(Option.isSome(status) && { status: status.value }),
          ...(Option.isSome(type) && { type: type.value }),
        });
        const result = yield* api.listReservations(accessToken, query);
        if (json) {
          yield* Console.log(JSON.stringify(result));
          return;
        }
        yield* Console.log(
          `Reservations: ${result.total} total · page ${result.page}/${result.pageCount}`
        );
        for (const reservation of result.items) {
          yield* Console.log(formatReservationRow(reservation));
        }
      })
    )
).pipe(Command.withDescription("List and filter reservations"));

const reservationsGetCommand = Command.make(
  "get",
  {
    reservationId: Argument.string("reservation-id").pipe(
      Argument.withSchema(AdministrationWorkspaceReservationId)
    ),
  },
  ({ reservationId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const detail = yield* api.getReservation(accessToken, reservationId);
        if (json) {
          yield* Console.log(JSON.stringify(detail));
          return;
        }
        const reservation = detail.reservation;
        yield* Console.log(
          [
            reservation.id,
            reservation.date ?? reservation.startsAt ?? "Unknown date",
            reservation.typeLabel,
            reservation.customer?.displayName ?? reservation.customerId,
            reservation.status.label,
          ].join("\t")
        );
        yield* Console.log(
          `${detail.paymentAttempts.length} payment attempts · ${detail.orders.length} provider orders · ${detail.discounts.length} discounts`
        );
        yield* Console.log(
          detail.accessGrant
            ? formatReservationAccessGrant(detail.accessGrant)
            : "Access: not provisioned"
        );
      })
    )
).pipe(Command.withDescription("Show a reservation and its history"));

const reservationsFindCommand = Command.make(
  "find",
  { identifier: Argument.string("identifier") },
  ({ identifier }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const result = yield* api.findReservation(accessToken, identifier);
        if (json) {
          yield* Console.log(JSON.stringify(result));
          return;
        }
        yield* Console.log(result.reservationId ?? "No reservation matched.");
      })
    )
).pipe(
  Command.withDescription("Find a reservation by reservation or payment ID")
);

const reservationsCancelCommand = Command.make(
  "cancel",
  {
    reservationId: Argument.string("reservation-id"),
    providerCredentialRemoved: Flag.boolean(
      "confirm-access-credential-removed"
    ).pipe(
      Flag.withDescription(
        "Confirm any active door PIN was removed in Igloohome"
      )
    ),
    sendCancellationEmail: Flag.boolean("send-cancellation-email").pipe(
      Flag.withDescription("Email the customer after cancellation")
    ),
    yes: confirmationFlag,
  },
  ({ providerCredentialRemoved, reservationId, sendCancellationEmail, yes }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const decodedReservationId = yield* Schema.decodeUnknownEffect(
          AdministrationWorkspaceReservationId
        )(reservationId);
        const confirmed = yield* confirmChange(
          yes,
          json,
          "Cancel this reservation? Paid online payments will be marked as needing a refund; no refund is issued automatically."
        );
        if (!confirmed) {
          yield* reportCancellation(json);
          return;
        }
        const accessGrantUpdatedAt = providerCredentialRemoved
          ? ((yield* api.getReservation(accessToken, decodedReservationId))
              .accessGrant?.updatedAt ?? null)
          : null;
        const result = yield* api.cancelReservation(
          accessToken,
          decodedReservationId,
          {
            accessGrantUpdatedAt,
            providerCredentialRemoved,
            sendCancellationEmail,
          }
        );
        yield* Console.log(
          json
            ? JSON.stringify(result)
            : {
                failed:
                  "Reservation cancelled, but the cancellation email could not be sent.",
                not_requested:
                  "Reservation cancelled without emailing the customer.",
                sent: "Reservation cancelled and the customer was emailed.",
              }[result.email]
        );
      })
    )
).pipe(Command.withDescription("Cancel a reservation in Dotypos"));

const reservationsRetryAccessCommand = Command.make(
  "retry-access",
  {
    reservationId: Argument.string("reservation-id").pipe(
      Argument.withSchema(AdministrationWorkspaceReservationId)
    ),
    yes: confirmationFlag,
  },
  ({ reservationId, yes }) =>
    runConfirmedReservationAccessMutation({
      confirmation: `Retry failed access issuance for ${reservationId}?`,
      mutation: { kind: "retry-failed" },
      reservationId,
      yes,
    })
).pipe(Command.withDescription("Retry definitively failed access issuance"));

const reservationsReconcileAccessCommand = Command.make(
  "reconcile-access",
  {
    reservationId: Argument.string("reservation-id").pipe(
      Argument.withSchema(AdministrationWorkspaceReservationId)
    ),
    providerCredentialRemoved: Flag.boolean("provider-credential-removed").pipe(
      Flag.withDescription(
        "Confirm the possible AlgoPIN was removed or verified absent in Igloohome"
      )
    ),
    yes: confirmationFlag,
  },
  ({ providerCredentialRemoved, reservationId, yes }) =>
    runConfirmedReservationAccessMutation({
      confirmation: `Confirm the possible Igloohome credential for ${reservationId} was removed, then retry access issuance?`,
      mutation: {
        kind: "confirm-provider-credential-removed",
        providerCredentialRemoved: true,
      },
      providerCredentialRemoved,
      reservationId,
      yes,
    })
).pipe(
  Command.withDescription(
    "Reconcile uncertain access after manual provider removal"
  )
);

const reservationsCommand = Command.make("reservations").pipe(
  Command.withDescription("Inspect and cancel Workspace reservations"),
  Command.withSubcommands([
    reservationsListCommand,
    reservationsGetCommand,
    reservationsFindCommand,
    reservationsCancelCommand,
    reservationsRetryAccessCommand,
    reservationsReconcileAccessCommand,
  ])
);

const bookingsListCommand = Command.make(
  "list",
  {
    date: Flag.string("date").pipe(
      Flag.optional,
      Flag.withDescription("Filter by booking date (YYYY-MM-DD)")
    ),
    page: Flag.integer("page").pipe(
      Flag.optional,
      Flag.withDescription("Results page")
    ),
  },
  ({ date, page }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const query: AdministrationBookingQueryType = {
          ...(Option.isSome(date) && { date: date.value }),
          ...(Option.isSome(page) && { page: page.value }),
        };
        const result = yield* api.listBookings(accessToken, query);
        if (json) {
          yield* Console.log(JSON.stringify(result));
          return;
        }
        yield* Console.log(
          `Bookings: ${result.total} total · page ${result.page}/${result.pageCount}`
        );
        for (const booking of result.items) {
          yield* Console.log(
            [
              booking.id,
              booking.startsAt,
              booking.tableName ?? "Unassigned",
              booking.customer?.displayName ??
                booking.customerId ??
                "Unknown customer",
              booking.statusLabel,
            ].join("\t")
          );
        }
      })
    )
).pipe(Command.withDescription("List and filter Dotypos bookings"));

const bookingsGetCommand = Command.make(
  "get",
  { bookingId: Argument.string("booking-id") },
  ({ bookingId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const decodedBookingId = yield* Schema.decodeUnknownEffect(
          AdministrationDotyposReservationId
        )(bookingId);
        const detail = yield* api.getBooking(accessToken, decodedBookingId);
        if (json) {
          yield* Console.log(JSON.stringify(detail));
          return;
        }
        const booking = detail.booking;
        yield* Console.log(
          [
            booking.id,
            booking.startsAt,
            booking.endsAt,
            booking.tableName ?? "Unassigned",
            booking.customer?.displayName ??
              booking.customerId ??
              "Unknown customer",
            booking.statusLabel,
          ].join("\t")
        );
        if (detail.references.workspaceReservationId) {
          yield* Console.log(
            `Workspace reservation: ${detail.references.workspaceReservationId}`
          );
        }
      })
    )
).pipe(Command.withDescription("Show a Dotypos booking"));

const bookingsCommand = Command.make("bookings").pipe(
  Command.withDescription("Inspect Dotypos bookings"),
  Command.withSubcommands([bookingsListCommand, bookingsGetCommand])
);

const administrationDateRangeFlags = {
  from: Flag.string("from").pipe(
    Flag.optional,
    Flag.withDescription("Start date (YYYY-MM-DD)")
  ),
  to: Flag.string("to").pipe(
    Flag.optional,
    Flag.withDescription("End date (YYYY-MM-DD)")
  ),
};

const ordersListCommand = Command.make("list", {}, () =>
  runAuthenticatedCommand((api, accessToken, json) =>
    Effect.gen(function* () {
      const result = yield* api.listOrders(accessToken);
      if (json) {
        yield* Console.log(JSON.stringify(result));
        return;
      }
      yield* Console.log(
        `Orders: ${result.items.length}${result.truncated ? "+" : ""}`
      );
      for (const order of result.items) {
        yield* Console.log(
          [
            order.id,
            order.kind,
            order.paymentState,
            order.fulfillmentState,
            formatMoney(order.total),
          ].join("\t")
        );
      }
    })
  )
).pipe(Command.withDescription("List Deskohub orders"));

const ordersGetCommand = Command.make(
  "get",
  {
    orderId: Argument.string("order-id").pipe(
      Argument.withSchema(AdministrationOrderId)
    ),
  },
  ({ orderId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const detail = yield* api.getOrder(accessToken, orderId);
        if (json) {
          yield* Console.log(JSON.stringify(detail));
          return;
        }
        const order = detail.order;
        yield* Console.log(
          [
            order.id,
            order.kind,
            order.paymentState,
            order.fulfillmentState,
            formatMoney(order.total),
          ].join("\t")
        );
        yield* Console.log(
          `${detail.lines.length} lines · ${detail.paymentAttempts.length} payment attempts · invoice ${detail.invoice.status.replace("_", " ")}`
        );
      })
    )
).pipe(Command.withDescription("Show a Deskohub order"));

const ordersCommand = Command.make("orders").pipe(
  Command.withDescription("Inspect Deskohub orders"),
  Command.withSubcommands([ordersListCommand, ordersGetCommand])
);

const nexiOrdersListCommand = Command.make(
  "list",
  administrationDateRangeFlags,
  ({ from, to }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const query: AdministrationNexiOrderQueryType = {
          ...(Option.isSome(from) && { from: from.value }),
          ...(Option.isSome(to) && { to: to.value }),
        };
        const result = yield* api.listNexiOrders(accessToken, query);
        if (json) {
          yield* Console.log(JSON.stringify(result));
          return;
        }
        yield* Console.log(
          `Orders: ${result.items.length}${result.truncated ? "+" : ""} · provider ${result.providerAvailable ? "available" : "unavailable"}`
        );
        for (const order of result.items) {
          yield* Console.log(
            [
              order.orderId,
              order.providerStatus,
              order.link?.stateLabel ?? "Not linked",
              order.link?.reservationId ?? "No reservation",
            ].join("\t")
          );
        }
      })
    )
).pipe(Command.withDescription("List Nexi orders"));

const nexiOrdersGetCommand = Command.make(
  "get",
  { orderId: Argument.string("order-id") },
  ({ orderId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const decodedOrderId = yield* Schema.decodeUnknownEffect(
          AdministrationNexiOrderId
        )(orderId);
        const order = yield* api.getNexiOrder(accessToken, decodedOrderId);
        if (json) {
          yield* Console.log(JSON.stringify(order));
          return;
        }
        yield* Console.log(
          [
            order.orderId,
            order.providerStatus,
            order.link?.stateLabel ?? "Not linked",
            order.link?.reservationId ?? "No reservation",
          ].join("\t")
        );
        if (order.provider) {
          yield* Console.log(
            `${order.provider.operations.length} provider operations`
          );
        }
      })
    )
).pipe(Command.withDescription("Show a Nexi order"));

const nexiOrdersCommand = Command.make("orders").pipe(
  Command.withDescription("Inspect Nexi orders"),
  Command.withSubcommands([nexiOrdersListCommand, nexiOrdersGetCommand])
);

const invoicesListCommand = Command.make(
  "list",
  {
    sort: Flag.choice("sort", [
      "invoiceNumber",
      "issuedAt",
      "customer",
      "total",
      "paymentStatus",
      "source",
      "delivery",
    ]).pipe(Flag.optional, Flag.withDescription("Sort field")),
    direction: Flag.choice("direction", ["asc", "desc"]).pipe(
      Flag.optional,
      Flag.withDescription("Sort direction")
    ),
    page: Flag.integer("page").pipe(
      Flag.optional,
      Flag.withDescription("Results page")
    ),
  },
  ({ direction, page, sort }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const query = yield* Schema.decodeUnknownEffect(
          AdministrationInvoiceQuery
        )({
          ...(Option.isSome(sort) && { sort: sort.value }),
          ...(Option.isSome(direction) && { direction: direction.value }),
          ...(Option.isSome(page) && { page: page.value }),
        });
        const result = yield* api.listInvoices(accessToken, query);
        if (json) {
          yield* Console.log(JSON.stringify(result));
          return;
        }
        yield* Console.log(
          `Invoices: ${result.total} total · page ${result.page}/${result.pageCount}`
        );
        for (const invoice of result.items) {
          yield* Console.log(
            [
              invoice.id,
              invoice.invoiceNumber,
              invoice.issuedAt,
              invoice.customerName,
              `${invoice.total} ${invoice.currency}`,
              invoice.paymentStatus,
              getInvoiceDeliveryLabel(invoice),
            ].join("\t")
          );
        }
      })
    )
).pipe(Command.withDescription("List issued invoices"));

const invoicesGetCommand = Command.make(
  "get",
  {
    invoiceId: Argument.string("invoice-id").pipe(
      Argument.withSchema(AdministrationInvoiceId)
    ),
  },
  ({ invoiceId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const invoice = yield* api.getInvoice(accessToken, invoiceId);
        if (json) {
          yield* Console.log(JSON.stringify(invoice));
          return;
        }
        yield* Console.log(
          [
            invoice.invoiceNumber,
            invoice.issuedAt,
            invoice.customerName,
            `${invoice.total} ${invoice.currency}`,
            invoice.paymentStatus,
            invoice.source,
            getInvoiceDeliveryLabel(invoice),
          ].join("\t")
        );
        for (const line of invoice.lines) {
          yield* Console.log(`${line.description}\t${line.price}`);
        }
      })
    )
).pipe(Command.withDescription("Show an issued invoice"));

const invoicesCreateCommand = Command.make(
  "create",
  {
    input: Flag.string("input").pipe(
      Flag.withDescription("Strict JSON invoice input file")
    ),
    yes: confirmationFlag,
  },
  ({ input, yes }) =>
    runAuthenticatedCommand((api, accessToken, json, session) =>
      Effect.gen(function* () {
        if (session.approvedBy === null) {
          return yield* new AuthenticationRequiredError({
            message:
              "This legacy CLI session cannot issue invoices. Run dhw auth again.",
          });
        }
        const invoiceInput = yield* readInvoiceCreateInput(input);
        const confirmed = yield* confirmChange(
          yes,
          json,
          "Create this immutable invoice and immediately email it to both the customer and Deskohub?"
        );
        if (!confirmed) {
          yield* reportCancellation(json);
          return;
        }
        const result = yield* api.createInvoice(accessToken, invoiceInput);
        yield* Console.log(
          json ? JSON.stringify(result) : formatInvoiceCreationOutput(result)
        );
      })
    )
).pipe(Command.withDescription("Create and immediately email an invoice"));

export const formatInvoiceCreationOutput = (result: {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly needsAttention: boolean;
}) =>
  result.needsAttention
    ? `Created ${result.invoiceNumber} (${result.invoiceId}); delivery needs attention.`
    : `Created and sent ${result.invoiceNumber} (${result.invoiceId}).`;

const getInvoiceDeliveryLabel = (invoice: {
  readonly delivery: Readonly<
    Record<
      "customer" | "internal",
      "missing" | "processing" | "accepted" | "failed"
    >
  >;
  readonly needsAttention: boolean;
}) => {
  if (invoice.needsAttention) return "Needs resend";
  return invoice.delivery.customer === "accepted" &&
    invoice.delivery.internal === "accepted"
    ? "Sent"
    : "Sending";
};

const invoicesDownloadCommand = Command.make(
  "download",
  {
    invoiceId: Argument.string("invoice-id").pipe(
      Argument.withSchema(AdministrationInvoiceId)
    ),
    output: Flag.string("output").pipe(
      Flag.optional,
      Flag.withDescription("PDF output path")
    ),
  },
  ({ invoiceId, output }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const pdf = yield* api.getInvoicePdf(accessToken, invoiceId);
        const path = Option.getOrElse(output, () => `${invoiceId}.pdf`);
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.writeFile(path, pdf);
        yield* Console.log(
          json
            ? JSON.stringify({ invoiceId, path })
            : `Downloaded invoice ${invoiceId} to ${path}.`
        );
      })
    )
).pipe(Command.withDescription("Download an invoice PDF"));

const invoicesResendCommand = Command.make(
  "resend",
  {
    invoiceId: Argument.string("invoice-id").pipe(
      Argument.withSchema(AdministrationInvoiceId)
    ),
    yes: confirmationFlag,
  },
  ({ invoiceId, yes }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const confirmed = yield* confirmChange(
          yes,
          json,
          `Retry missing or failed email delivery for invoice ${invoiceId}?`
        );
        if (!confirmed) {
          yield* reportCancellation(json);
          return;
        }
        const result = yield* api.resendInvoice(accessToken, invoiceId);
        if (json) {
          yield* Console.log(JSON.stringify(result));
          return;
        }
        yield* Console.log(
          result.changed
            ? `Retried delivery for invoice ${invoiceId}.`
            : `Invoice ${invoiceId} had no retryable delivery.`
        );
      })
    )
).pipe(Command.withDescription("Retry missing or failed invoice email"));

const invoicesCommand = Command.make("invoices").pipe(
  Command.withDescription("Create and manage invoices"),
  Command.withSubcommands([
    invoicesListCommand,
    invoicesGetCommand,
    invoicesCreateCommand,
    invoicesDownloadCommand,
    invoicesResendCommand,
  ])
);

const nexiOperationsListCommand = Command.make(
  "list",
  {
    ...administrationDateRangeFlags,
    channel: Flag.string("channel").pipe(
      Flag.optional,
      Flag.withDescription("Filter by provider channel")
    ),
    operationType: Flag.string("operation-type").pipe(
      Flag.optional,
      Flag.withDescription("Filter by provider operation type")
    ),
  },
  ({ channel, from, operationType, to }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const query: AdministrationNexiOperationQueryType = {
          ...(Option.isSome(from) && { from: from.value }),
          ...(Option.isSome(to) && { to: to.value }),
          ...(Option.isSome(channel) && { channel: channel.value }),
          ...(Option.isSome(operationType) && {
            operationType: operationType.value,
          }),
        };
        const result = yield* api.listNexiOperations(accessToken, query);
        if (json) {
          yield* Console.log(JSON.stringify(result));
          return;
        }
        yield* Console.log(
          `Operations: ${result.items.length}${result.truncated ? "+" : ""} · provider ${result.providerAvailable ? "available" : "unavailable"}`
        );
        for (const operation of result.items) {
          yield* Console.log(
            [
              operation.operationId ?? "Unknown operation",
              operation.operationTime ?? "Unknown time",
              operation.operationType ?? "Unknown type",
              operation.operationResult ?? "Unknown result",
              operation.orderId ?? "No order",
              operation.linkedReservationId ?? "No reservation",
            ].join("\t")
          );
        }
      })
    )
).pipe(Command.withDescription("List Nexi operations"));

const nexiOperationsGetCommand = Command.make(
  "get",
  { operationId: Argument.string("operation-id") },
  ({ operationId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const decodedOperationId = yield* Schema.decodeUnknownEffect(
          AdministrationNexiOperationId
        )(operationId);
        const detail = yield* api.getNexiOperation(
          accessToken,
          decodedOperationId
        );
        if (json) {
          yield* Console.log(JSON.stringify(detail));
          return;
        }
        yield* Console.log(
          [
            detail.operationId,
            detail.providerStatus,
            detail.operation?.operationType ?? "Unknown type",
            detail.operation?.operationResult ?? "Unknown result",
            detail.operation?.orderId ?? "No order",
            detail.linkedReservationId ?? "No reservation",
          ].join("\t")
        );
      })
    )
).pipe(Command.withDescription("Show a Nexi operation"));

const nexiOperationsCommand = Command.make("operations").pipe(
  Command.withDescription("Inspect Nexi operations"),
  Command.withSubcommands([nexiOperationsListCommand, nexiOperationsGetCommand])
);

const nexiCommand = Command.make("nexi").pipe(
  Command.withDescription("Inspect Nexi payment records"),
  Command.withSubcommands([nexiOrdersCommand, nexiOperationsCommand])
);

const customersListCommand = Command.make(
  "list",
  {
    page: Flag.integer("page").pipe(
      Flag.optional,
      Flag.withDescription("Results page")
    ),
  },
  ({ page }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const query: AdministrationCustomerQueryType = {
          ...(Option.isSome(page) && { page: page.value }),
        };
        const result = yield* api.listCustomers(accessToken, query);
        if (json) {
          yield* Console.log(JSON.stringify(result));
          return;
        }
        yield* Console.log(
          `Customers: ${result.total} total · page ${result.page}/${result.pageCount}`
        );
        for (const item of result.items) {
          const customer = item.customer;
          yield* Console.log(
            [
              item.customerId,
              customer?.displayName ?? "Details unavailable",
              customer?.email ?? customer?.phone ?? "No contact details",
              `${item.reservationCount} reservations`,
              item.lastActivityAt,
            ].join("\t")
          );
        }
      })
    )
).pipe(Command.withDescription("List customers with reservations"));

const customersSearchCommand = Command.make(
  "search",
  { query: Argument.string("query") },
  ({ query }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const result = yield* api.searchCustomers(accessToken, { query });
        if (json) {
          yield* Console.log(JSON.stringify(result));
          return;
        }
        if (result.customers.length === 0) {
          yield* Console.log("No customer matched.");
          return;
        }
        if (result.kind === "ambiguous") {
          yield* Console.log("Multiple customers matched:");
        }
        for (const customer of result.customers) {
          yield* Console.log(
            [
              customer.id,
              customer.displayName,
              customer.email ?? customer.phone ?? "No contact details",
            ].join("\t")
          );
        }
      })
    )
).pipe(Command.withDescription("Search customers by name or email"));

const customersGetCommand = Command.make(
  "get",
  { customerId: Argument.string("customer-id") },
  ({ customerId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const decodedCustomerId = yield* Schema.decodeUnknownEffect(
          AdministrationDotyposCustomerId
        )(customerId);
        const detail = yield* api.getCustomer(accessToken, decodedCustomerId);
        if (json) {
          yield* Console.log(JSON.stringify(detail));
          return;
        }
        const profile = detail.profile;
        yield* Console.log(
          profile
            ? [
                profile.customer.id,
                profile.customer.displayName,
                profile.customer.email ??
                  profile.customer.phone ??
                  "No contact details",
              ].join("\t")
            : `${customerId}\tLive customer details unavailable`
        );
        yield* Console.log(
          `${detail.activity.stats.reservationCount} reservations · ${profile?.codes.length ?? 0} discount codes · ${profile?.claims.length ?? 0} code claims`
        );
        if (detail.activity.stats.favoriteProduct) {
          yield* Console.log(
            `Favorite product: ${detail.activity.stats.favoriteProduct}`
          );
        }
      })
    )
).pipe(Command.withDescription("Show customer activity and discount details"));

const customersReservationsCommand = Command.make(
  "reservations",
  {
    customerId: Argument.string("customer-id"),
    page: Flag.integer("page").pipe(
      Flag.optional,
      Flag.withDescription("Results page")
    ),
  },
  ({ customerId, page }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const decodedCustomerId = yield* Schema.decodeUnknownEffect(
          AdministrationDotyposCustomerId
        )(customerId);
        const result = yield* api.listCustomerReservations(
          accessToken,
          decodedCustomerId,
          { ...(Option.isSome(page) && { page: page.value }) }
        );
        if (json) {
          yield* Console.log(JSON.stringify(result));
          return;
        }
        yield* Console.log(
          `Reservations: ${result.total} total · page ${result.page}/${result.pageCount}`
        );
        for (const reservation of result.items) {
          yield* Console.log(formatReservationRow(reservation));
        }
      })
    )
).pipe(Command.withDescription("List a customer's reservations"));

const customersSetDiscountGroupCommand = Command.make(
  "set-discount-group",
  {
    customerId: Argument.string("customer-id").pipe(
      Argument.withSchema(AdministrationDotyposCustomerId)
    ),
    discountGroupId: Argument.string("discount-group-id").pipe(
      Argument.withSchema(AdministrationDotyposDiscountGroupId)
    ),
    yes: confirmationFlag,
  },
  ({ customerId, discountGroupId, yes }) =>
    runConfirmedDiscountMutation({
      confirmation: `Set Dotypos discount group ${discountGroupId} for ${customerId}?`,
      mutation: {
        kind: "set-customer-discount-group",
        customerId,
        discountGroupId,
      },
      yes,
    })
).pipe(Command.withDescription("Set a customer's Dotypos discount group"));

const customersClearDiscountGroupCommand = Command.make(
  "clear-discount-group",
  {
    customerId: Argument.string("customer-id").pipe(
      Argument.withSchema(AdministrationDotyposCustomerId)
    ),
    yes: confirmationFlag,
  },
  ({ customerId, yes }) =>
    runConfirmedDiscountMutation({
      confirmation: `Clear the Dotypos discount group for ${customerId}?`,
      mutation: {
        kind: "set-customer-discount-group",
        customerId,
        discountGroupId: null,
      },
      yes,
    })
).pipe(Command.withDescription("Clear a customer's Dotypos discount group"));

const customersCommand = Command.make("customers").pipe(
  Command.withDescription("Inspect Workspace customers"),
  Command.withSubcommands([
    customersListCommand,
    customersSearchCommand,
    customersGetCommand,
    customersReservationsCommand,
    customersSetDiscountGroupCommand,
    customersClearDiscountGroupCommand,
  ])
);

const administrationProductTargetArgument = Schema.String.check(
  Schema.isPattern(
    /^(?:cowork|meeting-room|office|goods|goods:(?:category|product):.+)$/
  )
).pipe(
  Schema.decodeTo(AdministrationWorkspaceProductTarget, {
    decode: SchemaGetter.transform(
      (value): AdministrationWorkspaceProductTargetType => {
        if (
          value === "cowork" ||
          value === "meeting-room" ||
          value === "office" ||
          value === "goods"
        ) {
          return { kind: value } as AdministrationWorkspaceProductTargetType;
        }
        if (value.startsWith("goods:category:")) {
          return {
            kind: "goods" as const,
            categoryId: value.slice("goods:category:".length),
          } as AdministrationWorkspaceProductTargetType;
        }
        return {
          kind: "goods" as const,
          productId: value.slice("goods:product:".length),
        } as AdministrationWorkspaceProductTargetType;
      }
    ),
    encode: SchemaGetter.transform((target) => {
      if (target.kind !== "goods") return target.kind;
      if ("categoryId" in target) {
        return `goods:category:${target.categoryId}`;
      }
      if ("productId" in target) return `goods:product:${target.productId}`;
      return target.kind;
    }),
  })
);

const discountDefinitionFlags = {
  labelCs: Flag.string("label-cs").pipe(
    Flag.withSchema(Schema.Trim.check(Schema.isNonEmpty())),
    Flag.withDescription("Czech customer-facing label")
  ),
  labelEn: Flag.string("label-en").pipe(
    Flag.withSchema(Schema.Trim.check(Schema.isNonEmpty())),
    Flag.withDescription("English customer-facing label")
  ),
  products: Flag.string("product").pipe(
    Flag.withSchema(administrationProductTargetArgument),
    Flag.atLeast(1),
    Flag.withDescription(
      "Eligible target: cowork, meeting-room, office, goods, goods:category:<id>, or goods:product:<id>; repeat for multiple targets"
    )
  ),
};

const percentageBasisPointsFromString = Schema.String.check(
  Schema.isPattern(/^\d+(?:\.\d+)?$/)
).pipe(
  Schema.decodeTo(
    Schema.BigDecimalFromString.check(
      Schema.isBetweenBigDecimal({
        minimum: BigDecimal.fromBigInt(BigInt(0)),
        maximum: BigDecimal.fromBigInt(BigInt(100)),
        exclusiveMinimum: true,
      }),
      Schema.makeFilter(
        (percentage) =>
          BigDecimal.isInteger(
            BigDecimal.multiply(percentage, BigDecimal.fromBigInt(BigInt(100)))
          ),
        { message: "must convert exactly to whole basis points" }
      )
    )
  ),
  Schema.decodeTo(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
    {
      decode: SchemaGetter.transform((percentage) =>
        Number(
          BigDecimal.scale(
            BigDecimal.multiply(percentage, BigDecimal.fromBigInt(BigInt(100))),
            0
          ).value
        )
      ),
      encode: SchemaGetter.transform((basisPoints) =>
        BigDecimal.make(BigInt(basisPoints), 2)
      ),
    }
  )
);

const percentageFlag = Flag.string("percentage").pipe(
  Flag.withSchema(percentageBasisPointsFromString),
  Flag.withDescription("Percentage from 0.01 through 100")
);

const fixedValueFlag = Flag.integer("fixed-value").pipe(
  Flag.withSchema(Schema.Int.check(Schema.isGreaterThan(0))),
  Flag.withDescription("Money value in minor currency units")
);

const fixedCurrencyFlag = Flag.choice("currency", ["CZK", "EUR"]).pipe(
  Flag.withDescription("Currency for the money value")
);

const discountIdArgument = Argument.string("discount-id").pipe(
  Argument.withSchema(AdministrationStoredDiscountId)
);

const discountsCreatePercentageCommand = Command.make(
  "percentage",
  { ...discountDefinitionFlags, percentage: percentageFlag },
  ({ labelCs, labelEn, percentage, products }) =>
    runDiscountMutation({
      kind: "create-discount",
      discount: makeDiscountDefinition({
        adjustment: { kind: "percentage", basisPoints: percentage },
        labelCs,
        labelEn,
        products,
      }),
    })
).pipe(Command.withDescription("Create a percentage discount definition"));

const discountsCreateFixedCommand = Command.make(
  "fixed",
  {
    ...discountDefinitionFlags,
    currency: fixedCurrencyFlag,
    fixedValue: fixedValueFlag,
  },
  ({ currency, fixedValue, labelCs, labelEn, products }) =>
    runDiscountMutation({
      kind: "create-discount",
      discount: makeDiscountDefinition({
        adjustment: {
          kind: "fixed",
          amount: { value: fixedValue, exponent: 2, currency },
        },
        labelCs,
        labelEn,
        products,
      }),
    })
).pipe(Command.withDescription("Create a fixed-amount discount definition"));

const discountsCreateCommand = Command.make("create").pipe(
  Command.withDescription("Create a managed discount definition"),
  Command.withSubcommands([
    discountsCreatePercentageCommand,
    discountsCreateFixedCommand,
  ])
);

const discountsUpdatePercentageCommand = Command.make(
  "percentage",
  {
    discountId: discountIdArgument,
    ...discountDefinitionFlags,
    percentage: percentageFlag,
  },
  ({ discountId, labelCs, labelEn, percentage, products }) =>
    runDiscountMutation({
      kind: "update-discount",
      discount: {
        id: discountId,
        ...makeDiscountDefinition({
          adjustment: { kind: "percentage", basisPoints: percentage },
          labelCs,
          labelEn,
          products,
        }),
      },
    })
).pipe(Command.withDescription("Replace a discount with percentage values"));

const discountsUpdateFixedCommand = Command.make(
  "fixed",
  {
    discountId: discountIdArgument,
    ...discountDefinitionFlags,
    currency: fixedCurrencyFlag,
    fixedValue: fixedValueFlag,
  },
  ({ currency, discountId, fixedValue, labelCs, labelEn, products }) =>
    runDiscountMutation({
      kind: "update-discount",
      discount: {
        id: discountId,
        ...makeDiscountDefinition({
          adjustment: {
            kind: "fixed",
            amount: { value: fixedValue, exponent: 2, currency },
          },
          labelCs,
          labelEn,
          products,
        }),
      },
    })
).pipe(Command.withDescription("Replace a discount with fixed-amount values"));

const discountsUpdateCommand = Command.make("update").pipe(
  Command.withDescription("Replace a managed discount definition"),
  Command.withSubcommands([
    discountsUpdatePercentageCommand,
    discountsUpdateFixedCommand,
  ])
);

const discountsDeleteCommand = Command.make(
  "delete",
  { discountId: discountIdArgument, yes: confirmationFlag },
  ({ discountId, yes }) =>
    runConfirmedDiscountMutation({
      confirmation: `Delete discount ${discountId}? Referenced discounts cannot be deleted. This cannot be undone.`,
      mutation: { kind: "delete-discount", id: discountId },
      yes,
    })
).pipe(Command.withDescription("Delete an unreferenced discount definition"));

const discountsListCommand = Command.make("list", {}, () =>
  runAuthenticatedCommand((api, accessToken, json) =>
    Effect.gen(function* () {
      const dashboard = yield* api.getDiscountDashboard(accessToken);
      if (json) {
        yield* Console.log(JSON.stringify(dashboard.discounts));
        return;
      }
      yield* Console.log(`Discounts: ${dashboard.discounts.length}`);
      for (const discount of dashboard.discounts) {
        yield* Console.log(
          [
            discount.id,
            discount.labels["en-US"],
            formatDiscountAdjustment(discount.adjustment),
            `${discount.products.length} products`,
            `${discount.codeCount} codes`,
          ].join("\t")
        );
      }
    })
  )
).pipe(Command.withDescription("List managed discounts"));

const discountsCommand = Command.make("discounts").pipe(
  Command.withDescription("Inspect and manage discounts"),
  Command.withSubcommands([
    discountsListCommand,
    discountsCreateCommand,
    discountsUpdateCommand,
    discountsDeleteCommand,
  ])
);

const discountCodeArgument = Argument.string("code").pipe(
  Argument.map((code) => code.trim().toUpperCase()),
  Argument.withSchema(AdministrationCanonicalPromotionCode)
);

const discountCodeIdArgument = Argument.string("code-id").pipe(
  Argument.withSchema(AdministrationDiscountCodeId)
);

const customerIdFlag = Flag.string("customer").pipe(
  Flag.withSchema(AdministrationDotyposCustomerId),
  Flag.optional,
  Flag.withDescription("Restrict the new code to this Dotypos customer")
);

const discountCodeCreateFlags = {
  customer: customerIdFlag,
  disabled: Flag.boolean("disabled").pipe(
    Flag.withDescription("Create the code disabled")
  ),
  maxUses: Flag.integer("max-uses").pipe(
    Flag.withSchema(Schema.Int.check(Schema.isGreaterThan(0))),
    Flag.optional,
    Flag.withDescription("Maximum successful redemptions")
  ),
  maxUsesPerCustomer: Flag.integer("max-uses-per-customer").pipe(
    Flag.withSchema(Schema.Int.check(Schema.isGreaterThan(0))),
    Flag.optional,
    Flag.withDescription("Maximum successful redemptions per customer")
  ),
  validFrom: Flag.string("valid-from").pipe(
    Flag.withSchema(AdministrationInstant),
    Flag.optional,
    Flag.withDescription("Inclusive ISO instant")
  ),
  validUntil: Flag.string("valid-until").pipe(
    Flag.withSchema(AdministrationInstant),
    Flag.optional,
    Flag.withDescription("Exclusive ISO instant")
  ),
};

const codesCreateExistingCommand = Command.make(
  "existing",
  {
    code: discountCodeArgument,
    discountId: discountIdArgument,
    ...discountCodeCreateFlags,
  },
  (input) =>
    runDiscountMutation(
      makeCreateCodeMutation(input, {
        kind: "existing",
        discountId: input.discountId,
      })
    )
).pipe(Command.withDescription("Create a code for an existing discount"));

const codesCreatePercentageCommand = Command.make(
  "percentage",
  {
    code: discountCodeArgument,
    ...discountCodeCreateFlags,
    ...discountDefinitionFlags,
    percentage: percentageFlag,
  },
  (input) =>
    runDiscountMutation(
      makeCreateCodeMutation(input, {
        kind: "new",
        discount: makeDiscountDefinition({
          adjustment: {
            kind: "percentage",
            basisPoints: input.percentage,
          },
          labelCs: input.labelCs,
          labelEn: input.labelEn,
          products: input.products,
        }),
      })
    )
).pipe(
  Command.withDescription("Create a code and percentage discount atomically")
);

const codesCreateFixedCommand = Command.make(
  "fixed",
  {
    code: discountCodeArgument,
    ...discountCodeCreateFlags,
    ...discountDefinitionFlags,
    currency: fixedCurrencyFlag,
    fixedValue: fixedValueFlag,
  },
  (input) =>
    runDiscountMutation(
      makeCreateCodeMutation(input, {
        kind: "new",
        discount: makeDiscountDefinition({
          adjustment: {
            kind: "fixed",
            amount: {
              value: input.fixedValue,
              exponent: 2,
              currency: input.currency,
            },
          },
          labelCs: input.labelCs,
          labelEn: input.labelEn,
          products: input.products,
        }),
      })
    )
).pipe(Command.withDescription("Create a code and fixed discount atomically"));

const creditValueFlag = Flag.integer("credit-value").pipe(
  Flag.withSchema(Schema.Int.check(Schema.isGreaterThan(0))),
  Flag.withDescription("Issued credit in minor currency units")
);

const vouchersCreateCommand = Command.make(
  "create",
  {
    code: discountCodeArgument,
    customer: discountCodeCreateFlags.customer,
    disabled: discountCodeCreateFlags.disabled,
    validFrom: discountCodeCreateFlags.validFrom,
    validUntil: discountCodeCreateFlags.validUntil,
    currency: fixedCurrencyFlag,
    creditValue: creditValueFlag,
  },
  (input) =>
    Option.match(input.customer, {
      onNone: () =>
        runDiscountMutation({
          kind: "create-voucher",
          voucher: {
            code: input.code,
            enabled: !input.disabled,
            validFrom: Option.getOrNull(input.validFrom),
            validUntil: Option.getOrNull(input.validUntil),
            credit: {
              value: input.creditValue,
              exponent: 2,
              currency: input.currency,
            },
          },
        }),
      onSome: (customerId) =>
        runDiscountMutation({
          kind: "create-customer-voucher",
          voucher: {
            customerId,
            code: input.code,
            enabled: !input.disabled,
            validFrom: Option.getOrNull(input.validFrom),
            validUntil: Option.getOrNull(input.validUntil),
            credit: {
              value: input.creditValue,
              exponent: 2,
              currency: input.currency,
            },
          },
        }),
    })
).pipe(Command.withDescription("Create a promotional credit voucher"));

const codesCreateCommand = Command.make("create").pipe(
  Command.withDescription("Create a managed discount code"),
  Command.withSubcommands([
    codesCreateExistingCommand,
    codesCreatePercentageCommand,
    codesCreateFixedCommand,
  ])
);

const codesUpdateCommand = Command.make(
  "update",
  {
    codeId: discountCodeIdArgument,
    code: discountCodeArgument,
    discountId: discountIdArgument,
    enabled: Flag.choiceWithValue("enabled", [
      ["true", true],
      ["false", false],
    ] as const),
    maxUses: discountCodeCreateFlags.maxUses,
    maxUsesPerCustomer: discountCodeCreateFlags.maxUsesPerCustomer,
    validFrom: discountCodeCreateFlags.validFrom,
    validUntil: discountCodeCreateFlags.validUntil,
  },
  ({
    code,
    codeId,
    discountId,
    enabled,
    maxUses,
    maxUsesPerCustomer,
    validFrom,
    validUntil,
  }) =>
    runDiscountMutation({
      kind: "update-code",
      code: {
        id: codeId,
        discountId,
        code,
        enabled,
        maxUses: Option.getOrNull(maxUses),
        maxUsesPerCustomer: Option.getOrNull(maxUsesPerCustomer),
        validFrom: Option.getOrNull(validFrom),
        validUntil: Option.getOrNull(validUntil),
      },
    })
).pipe(Command.withDescription("Replace a managed discount code"));

const voucherIdArgument = Argument.string("voucher-id").pipe(
  Argument.withSchema(AdministrationVoucherId)
);

const vouchersUpdateCommand = Command.make(
  "update",
  {
    voucherId: voucherIdArgument,
    code: discountCodeArgument,
    enabled: Flag.choiceWithValue("enabled", [
      ["true", true],
      ["false", false],
    ] as const),
    validFrom: discountCodeCreateFlags.validFrom,
    validUntil: discountCodeCreateFlags.validUntil,
    currency: fixedCurrencyFlag,
    creditValue: creditValueFlag,
  },
  ({
    code,
    voucherId,
    currency,
    enabled,
    creditValue,
    validFrom,
    validUntil,
  }) =>
    runDiscountMutation({
      kind: "update-voucher",
      voucher: {
        id: voucherId,
        code,
        credit: { value: creditValue, exponent: 2, currency },
        enabled,
        validFrom: Option.getOrNull(validFrom),
        validUntil: Option.getOrNull(validUntil),
      },
    })
).pipe(Command.withDescription("Replace a managed voucher"));

const codesDeleteCommand = Command.make(
  "delete",
  { codeId: discountCodeIdArgument, yes: confirmationFlag },
  ({ codeId, yes }) =>
    runConfirmedDiscountMutation({
      confirmation: `Delete discount code ${codeId}? Codes with claim history cannot be deleted. This cannot be undone.`,
      mutation: { kind: "delete-code", id: codeId },
      yes,
    })
).pipe(Command.withDescription("Delete an unused discount code"));

const codesAddCustomerCommand = Command.make(
  "add-customer",
  {
    codeId: discountCodeIdArgument,
    customerId: Argument.string("customer-id").pipe(
      Argument.withSchema(AdministrationDotyposCustomerId)
    ),
    yes: confirmationFlag,
  },
  ({ codeId, customerId, yes }) =>
    runConfirmedDiscountMutation({
      confirmation: `Add customer ${customerId} to the audience for code ${codeId}?`,
      mutation: { kind: "add-code-customer", codeId, customerId },
      yes,
    })
).pipe(Command.withDescription("Add a customer to a code audience"));

const codesRemoveCustomerCommand = Command.make(
  "remove-customer",
  {
    codeId: discountCodeIdArgument,
    customerId: Argument.string("customer-id").pipe(
      Argument.withSchema(AdministrationDotyposCustomerId)
    ),
    yes: confirmationFlag,
  },
  ({ codeId, customerId, yes }) =>
    runConfirmedDiscountMutation({
      confirmation: `Remove customer ${customerId} from code ${codeId}?`,
      mutation: { kind: "remove-code-customer", codeId, customerId },
      yes,
    })
).pipe(Command.withDescription("Remove a customer from a code audience"));

const codesMakeUnrestrictedCommand = Command.make(
  "make-unrestricted",
  { codeId: discountCodeIdArgument, yes: confirmationFlag },
  ({ codeId, yes }) =>
    runConfirmedDiscountMutation({
      confirmation: `Make code ${codeId} available to every customer?`,
      mutation: { kind: "make-code-unrestricted", codeId },
      yes,
    })
).pipe(Command.withDescription("Remove all customer restrictions from a code"));

const codesListCommand = Command.make("list", {}, () =>
  runAuthenticatedCommand((api, accessToken, json) =>
    Effect.gen(function* () {
      const dashboard = yield* api.getDiscountDashboard(accessToken);
      if (json) {
        yield* Console.log(JSON.stringify(dashboard.codes));
        return;
      }
      yield* Console.log(`Discount codes: ${dashboard.codes.length}`);
      const discountLabels = new Map(
        dashboard.discounts.map((discount) => [
          discount.id,
          discount.labels["en-US"],
        ])
      );
      for (const code of dashboard.codes) {
        yield* Console.log(
          [
            code.id,
            code.code,
            formatCodeBenefit(code, discountLabels),
            code.enabled ? "Enabled" : "Disabled",
            `${formatCodeRemaining(code)} globally`,
            `${code.maxUsesPerCustomer ?? "Unlimited"} per customer`,
          ].join("\t")
        );
      }
    })
  )
).pipe(Command.withDescription("List managed discount codes"));

const codesGetCommand = Command.make(
  "get",
  { codeId: discountCodeIdArgument },
  ({ codeId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const detail = yield* api.getDiscountCode(accessToken, codeId);
        if (json) {
          yield* Console.log(JSON.stringify(detail));
          return;
        }
        yield* Console.log(
          [
            detail.code.id,
            detail.code.code,
            detail.discountLabel,
            detail.code.enabled ? "Enabled" : "Disabled",
            `${formatCodeRemaining(detail.code)} globally`,
            `${detail.code.maxUsesPerCustomer ?? "Unlimited"} per customer`,
          ].join("\t")
        );
        yield* Console.log(
          `Validity\t${detail.code.validFrom ?? "No start"}\t${detail.code.validUntil ?? "No end"}`
        );
        yield* Console.log(
          detail.customers.length === 0
            ? "Audience\tUnrestricted"
            : `Audience\t${detail.customers.length} customers`
        );
        for (const { customer, customerId } of detail.customers) {
          yield* Console.log(
            [
              "Customer",
              customerId,
              customer?.displayName ?? "Unavailable",
            ].join("\t")
          );
        }
        yield* Console.log(`Claims\t${detail.claims.length}`);
        for (const claim of detail.claims) {
          yield* Console.log(
            [
              claim.state,
              formatMoney(claim.appliedAmount),
              claim.dotyposCustomerId,
              claim.workspaceReservationId,
              claim.reservedAt,
              claim.redeemedAt ?? claim.releasedAt ?? "Pending",
            ].join("\t")
          );
        }
      })
    )
).pipe(Command.withDescription("Show a discount code and its claims"));

const formatMoney = (
  money: {
    readonly value: number;
    readonly exponent: number;
    readonly currency: string;
  } | null
) =>
  money === null
    ? "Amount unavailable"
    : `${money.value / 10 ** money.exponent} ${money.currency}`;

const formatCodeBenefit = (
  code: AdministrationDiscountCodeType,
  discountLabels: ReadonlyMap<string, string>
) => discountLabels.get(code.discountId) ?? code.discountId;

const formatCodeRemaining = (
  code: AdministrationDiscountCodeType,
  unlimitedLabel: string | number = "Unlimited"
) => code.remainingUses ?? unlimitedLabel;

const codesCommand = Command.make("codes").pipe(
  Command.withDescription("Inspect and manage discount codes"),
  Command.withSubcommands([
    codesListCommand,
    codesGetCommand,
    codesCreateCommand,
    codesUpdateCommand,
    codesDeleteCommand,
    codesAddCustomerCommand,
    codesRemoveCustomerCommand,
    codesMakeUnrestrictedCommand,
  ])
);

const vouchersDeleteCommand = Command.make(
  "delete",
  { voucherId: voucherIdArgument, yes: confirmationFlag },
  ({ voucherId, yes }) =>
    runConfirmedDiscountMutation({
      confirmation: `Delete voucher ${voucherId}? Vouchers with claim history cannot be deleted. This cannot be undone.`,
      mutation: { kind: "delete-voucher", id: voucherId },
      yes,
    })
).pipe(Command.withDescription("Delete an unused voucher"));

const voucherCustomerArguments = {
  voucherId: voucherIdArgument,
  customerId: Argument.string("customer-id").pipe(
    Argument.withSchema(AdministrationDotyposCustomerId)
  ),
  yes: confirmationFlag,
};

const vouchersAddCustomerCommand = Command.make(
  "add-customer",
  voucherCustomerArguments,
  ({ customerId, voucherId, yes }) =>
    runConfirmedDiscountMutation({
      confirmation: `Add customer ${customerId} to voucher ${voucherId}?`,
      mutation: { kind: "add-voucher-customer", voucherId, customerId },
      yes,
    })
).pipe(Command.withDescription("Add a customer to a voucher audience"));

const vouchersRemoveCustomerCommand = Command.make(
  "remove-customer",
  voucherCustomerArguments,
  ({ customerId, voucherId, yes }) =>
    runConfirmedDiscountMutation({
      confirmation: `Remove customer ${customerId} from voucher ${voucherId}?`,
      mutation: { kind: "remove-voucher-customer", voucherId, customerId },
      yes,
    })
).pipe(Command.withDescription("Remove a customer from a voucher audience"));

const vouchersMakeUnrestrictedCommand = Command.make(
  "make-unrestricted",
  { voucherId: voucherIdArgument, yes: confirmationFlag },
  ({ voucherId, yes }) =>
    runConfirmedDiscountMutation({
      confirmation: `Make voucher ${voucherId} available to every customer?`,
      mutation: { kind: "make-voucher-unrestricted", voucherId },
      yes,
    })
).pipe(Command.withDescription("Remove all voucher customer restrictions"));

const vouchersListCommand = Command.make("list", {}, () =>
  runAuthenticatedCommand((api, accessToken, json) =>
    Effect.gen(function* () {
      const { vouchers } = yield* api.getDiscountDashboard(accessToken);
      if (json) {
        yield* Console.log(JSON.stringify(vouchers));
        return;
      }
      yield* Console.log(`Vouchers: ${vouchers.length}`);
      for (const voucher of vouchers) {
        yield* Console.log(
          [
            voucher.id,
            voucher.code,
            formatMoney(voucher.issuedCredit),
            formatMoney(voucher.remainingCredit),
            voucher.enabled ? "Enabled" : "Disabled",
          ].join("\t")
        );
      }
    })
  )
).pipe(Command.withDescription("List managed vouchers"));

const vouchersGetCommand = Command.make(
  "get",
  { voucherId: voucherIdArgument },
  ({ voucherId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const detail = yield* api.getVoucher(accessToken, voucherId);
        if (json) {
          yield* Console.log(JSON.stringify(detail));
          return;
        }
        const voucher = detail.voucher;
        yield* Console.log(
          [
            voucher.id,
            voucher.code,
            `${formatMoney(voucher.issuedCredit)} issued`,
            `${formatMoney(voucher.remainingCredit)} remaining`,
            voucher.enabled ? "Enabled" : "Disabled",
          ].join("\t")
        );
        yield* Console.log(
          `Validity\t${voucher.validFrom ?? "No start"}\t${voucher.validUntil ?? "No end"}`
        );
        yield* Console.log(
          detail.customers.length === 0
            ? "Audience\tUnrestricted"
            : `Audience\t${detail.customers.length} customers`
        );
        for (const { customer, customerId } of detail.customers) {
          yield* Console.log(
            [
              "Customer",
              customerId,
              customer?.displayName ?? "Unavailable",
            ].join("\t")
          );
        }
        yield* Console.log(`Claims\t${detail.claims.length}`);
        for (const claim of detail.claims) {
          yield* Console.log(
            [
              claim.state,
              formatMoney(claim.appliedAmount),
              claim.dotyposCustomerId,
              claim.workspaceReservationId,
              claim.reservedAt,
              claim.redeemedAt ?? claim.releasedAt ?? "Pending",
            ].join("\t")
          );
        }
      })
    )
).pipe(Command.withDescription("Show a voucher and its claims"));

const vouchersCommand = Command.make("vouchers").pipe(
  Command.withDescription("Inspect and manage promotional vouchers"),
  Command.withSubcommands([
    vouchersListCommand,
    vouchersGetCommand,
    vouchersCreateCommand,
    vouchersUpdateCommand,
    vouchersDeleteCommand,
    vouchersAddCustomerCommand,
    vouchersRemoveCustomerCommand,
    vouchersMakeUnrestrictedCommand,
  ])
);

const salesListCommand = Command.make("list", {}, () =>
  runAuthenticatedCommand((api, accessToken, json) =>
    Effect.gen(function* () {
      const dashboard = yield* api.getDiscountDashboard(accessToken);
      if (json) {
        yield* Console.log(JSON.stringify(dashboard.calendar));
        return;
      }
      const calendar = dashboard.calendar;
      yield* Console.log(
        `Calendar sales: ${calendar.events.length} · ${calendar.from} to ${calendar.to}${calendar.unavailable ? " · unavailable" : ""}`
      );
      for (const sale of calendar.events) {
        yield* Console.log(
          [
            sale.eventReference,
            sale.start,
            sale.end,
            sale.title,
            sale.association.kind,
          ].join("\t")
        );
      }
    })
  )
).pipe(Command.withDescription("List calendar-managed sales"));

const salesCommand = Command.make("sales").pipe(
  Command.withDescription("Inspect calendar-managed sales"),
  Command.withSubcommands([salesListCommand])
);

const sessionsListCommand = Command.make("list", {}, () =>
  runAuthenticatedCommand((api, accessToken, json) =>
    Effect.gen(function* () {
      const sessions = yield* api.listSessions(accessToken);
      if (json) {
        yield* Console.log(JSON.stringify(sessions));
        return;
      }
      yield* Console.log(`CLI sessions: ${sessions.length}`);
      for (const session of sessions) {
        yield* Console.log(
          [
            session.id,
            session.clientName,
            session.cliVersion,
            session.buildTarget,
            session.lastUsedAt,
            session.revokedAt ? "Revoked" : "Active",
          ].join("\t")
        );
      }
    })
  )
).pipe(Command.withDescription("List issued CLI sessions"));

const sessionsRenameCommand = Command.make(
  "rename",
  {
    sessionId: Argument.string("session-id").pipe(
      Argument.withSchema(CliSessionId)
    ),
    clientName: Argument.string("label").pipe(
      Argument.withSchema(CliClientName)
    ),
  },
  ({ clientName, sessionId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const result = yield* api.renameSession(accessToken, sessionId, {
          clientName,
        });
        yield* Console.log(
          json
            ? JSON.stringify(result)
            : `Renamed CLI session ${sessionId} to “${clientName}”.`
        );
      })
    )
).pipe(Command.withDescription("Rename an issued CLI session"));

const sessionsRevokeCommand = Command.make(
  "revoke",
  {
    sessionId: Argument.string("session-id").pipe(
      Argument.withSchema(CliSessionId)
    ),
    yes: confirmationFlag,
  },
  ({ sessionId, yes }) =>
    runAuthenticatedCommand((api, accessToken, json, currentSession) =>
      Effect.gen(function* () {
        const confirmed = yield* confirmChange(
          yes,
          json,
          `Revoke CLI session ${sessionId}? Its access will stop immediately. This cannot be undone.`
        );
        if (!confirmed) {
          yield* reportCancellation(json);
          return;
        }

        const result = yield* api.revokeSession(accessToken, sessionId);
        if (result.changed && sessionId === currentSession.id) {
          const authentication = yield* AuthenticationService;
          yield* authentication.clear;
        }
        const message = result.changed
          ? `Revoked CLI session ${sessionId}.`
          : `CLI session ${sessionId} was already revoked or no longer exists.`;
        yield* Console.log(json ? JSON.stringify(result) : message);
      })
    )
).pipe(Command.withDescription("Revoke an issued CLI session"));

const sessionsCommand = Command.make("sessions").pipe(
  Command.withDescription("Inspect and manage CLI sessions"),
  Command.withSubcommands([
    sessionsListCommand,
    sessionsRenameCommand,
    sessionsRevokeCommand,
  ])
);

const authCommand = Command.make(
  "auth",
  {
    name: Flag.string("name").pipe(
      Flag.optional,
      Flag.withDescription("Name shown for this client in the admin interface")
    ),
  },
  ({ name }) =>
    runCommand((json) =>
      Effect.gen(function* () {
        const authentication = yield* AuthenticationService;
        const existing = yield* authentication.current;

        if (Option.isSome(existing)) {
          yield* Console.log(
            json
              ? JSON.stringify({
                  authStatus: "granted",
                  session: existing.value.session,
                })
              : `Already authenticated as ${existing.value.session.clientName}.`
          );
          return;
        }

        const api = yield* WorkspaceAdminApiClient;
        const identity = yield* ClientIdentity;
        const config = yield* DhwConfig;
        const clientName = Option.isSome(name)
          ? name.value
          : yield* identity.defaultName;
        const verifier = yield* makeCliAuthenticationVerifier;
        const challenge = yield* makeCliAuthenticationChallenge(verifier);
        const started = yield* api.startAuthentication({
          challenge,
          clientName,
          cliVersion: DHW_VERSION,
          buildTarget: DHW_BUILD_TARGET,
        });
        const approvalUrl = new URL(started.approvalPath, config.baseUrl).href;

        yield* reportAuthenticationStarted({
          approvalUrl,
          expiresAt: started.expiresAt,
          json,
        });

        const session = yield* waitForCliAuthentication({
          api,
          authentication,
          code: started.code,
          verifier,
        });

        yield* reportAuthenticationGranted({ json, session });
      })
    )
).pipe(Command.withDescription("Authenticate this CLI through the admin UI"));

const updateCommand = Command.make(
  "update",
  {
    yes: Flag.boolean("yes").pipe(
      Flag.withDescription("Install an available update without prompting")
    ),
  },
  ({ yes }) =>
    Effect.gen(function* () {
      const { json } = yield* rootCommand;
      const updateService = yield* UpdateService;

      if (!isReleaseBuild) {
        yield* Console.log(
          json
            ? JSON.stringify({ status: "development-build" })
            : "Self-update is unavailable in development builds."
        );
        return;
      }

      const available = yield* updateService.check(true);

      if (Option.isNone(available)) {
        yield* Console.log(
          json
            ? JSON.stringify({ status: "current", version: DHW_VERSION })
            : `dhw ${DHW_VERSION} is current.`
        );
        return;
      }

      if (json && !yes) {
        yield* Console.log(
          JSON.stringify({ status: "available", ...available.value })
        );
        return;
      }

      const shouldInstall = yes || (yield* confirmUpdate(available.value));
      if (!shouldInstall) return;

      yield* installAndReport(available.value, json);
    })
).pipe(Command.withDescription("Check for and install a CLI update"));

export const dhwCommand = rootCommand.pipe(
  Command.withSubcommands([
    versionCommand,
    apiCommand,
    authCommand,
    bookingsCommand,
    codesCommand,
    customersCommand,
    discountsCommand,
    invoicesCommand,
    nexiCommand,
    overviewCommand,
    ordersCommand,
    reservationsCommand,
    salesCommand,
    sessionsCommand,
    updateCommand,
    vouchersCommand,
  ])
);

const waitForCliAuthentication = Effect.fn(
  "AuthenticationService.waitForApproval"
)(function* ({
  api,
  authentication,
  code,
  verifier,
}: {
  readonly api: WorkspaceAdminApiClient["Service"];
  readonly authentication: AuthenticationService["Service"];
  readonly code: Parameters<
    WorkspaceAdminApiClient["Service"]["getAuthenticationStatus"]
  >[0];
  readonly verifier: Parameters<typeof makeCliAuthenticationChallenge>[0];
}) {
  while (true) {
    const status = yield* api.getAuthenticationStatus(code);
    switch (status.authStatus) {
      case "pending":
        yield* Effect.sleep("2 seconds");
        break;
      case "approved": {
        const granted = yield* api.exchangeGrant({
          code,
          grantToken: status.grantToken,
          verifier,
        });
        yield* authentication.save(granted.accessToken);
        return granted.session;
      }
      case "expired":
        return yield* new AuthenticationFlowError({
          message: "The authentication request expired. Run dhw auth again.",
        });
      case "granted":
        return yield* new AuthenticationFlowError({
          message:
            "The authentication grant was already exchanged. Run dhw auth again on this machine.",
        });
      case "revoked":
        return yield* new AuthenticationFlowError({
          message: "The CLI session was revoked. Run dhw auth again.",
        });
    }
  }
});

class AuthenticationFlowError extends Data.TaggedError(
  "AuthenticationFlowError"
)<{ readonly message: string }> {}

class AuthenticationRequiredError extends Data.TaggedError(
  "AuthenticationRequiredError"
)<{ readonly message: string }> {}

class ConfirmationRequiredError extends Data.TaggedError(
  "ConfirmationRequiredError"
)<{ readonly message: string }> {}

class InvalidMutationInputError extends Data.TaggedError(
  "InvalidMutationInputError"
)<{ readonly message: string }> {}

const runCommand = <A, E, R>(
  operation: (json: boolean) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const { json } = yield* rootCommand;
    const result = yield* operation(json);
    yield* offerAutomaticUpdate(json);
    return result;
  });

const runAuthenticatedCommand = <A, E, R>(
  operation: (
    api: WorkspaceAdminApiClient["Service"],
    accessToken: Redacted.Redacted<CliAccessTokenType>,
    json: boolean,
    session: CliSessionType
  ) => Effect.Effect<A, E, R>
) =>
  runCommand((json) =>
    Effect.gen(function* () {
      const authentication = yield* AuthenticationService;
      const current = yield* authentication.current;
      if (Option.isNone(current)) {
        return yield* new AuthenticationRequiredError({
          message: "Run dhw auth before using administration commands.",
        });
      }
      const api = yield* WorkspaceAdminApiClient;
      return yield* operation(
        api,
        current.value.accessToken,
        json,
        current.value.session
      ).pipe(
        Effect.tapError((cause) =>
          cause instanceof CliSessionUnauthorized
            ? authentication.clear.pipe(Effect.asVoid)
            : Effect.void
        )
      );
    })
  );

const readInvoiceCreateInput = Effect.fn("dhw.invoices.readCreateInput")(
  function* (path: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const contents = yield* fileSystem.readFileString(path).pipe(
      Effect.mapError(
        () =>
          new InvalidMutationInputError({
            message: "The invoice input file could not be read.",
          })
      )
    );
    const json = yield* Effect.try({
      try: () => JSON.parse(contents) as unknown,
      catch: () =>
        new InvalidMutationInputError({
          message: "The invoice input file is not valid JSON.",
        }),
    });
    return yield* Schema.decodeUnknownEffect(
      AdministrationInvoiceCreateFileInput,
      { errors: "all", onExcessProperty: "error" }
    )(json).pipe(
      Effect.mapError(
        () =>
          new InvalidMutationInputError({
            message:
              "The invoice input is invalid or contains an unknown property.",
          })
      )
    );
  }
);

const makeDiscountDefinition = ({
  adjustment,
  labelCs,
  labelEn,
  products,
}: {
  readonly adjustment: AdministrationDiscountDefinitionInputType["adjustment"];
  readonly labelCs: string;
  readonly labelEn: string;
  readonly products: ReadonlyArray<AdministrationWorkspaceProductTargetType>;
}): AdministrationDiscountDefinitionInputType => ({
  adjustment,
  labels: { "cs-CZ": labelCs, "en-US": labelEn },
  products: [products[0]!, ...products.slice(1)],
});

type CreateCodeMutation = Extract<
  AdministrationDiscountMutationType,
  { readonly kind: "create-code" }
>;
type CreateCustomerCodeMutation = Extract<
  AdministrationDiscountMutationType,
  { readonly kind: "create-customer-code" }
>;

const makeCreateCodeMutation = (
  input: {
    readonly code: CreateCodeMutation["code"]["code"];
    readonly customer: Option.Option<CreateCustomerCodeMutation["customerId"]>;
    readonly disabled: boolean;
    readonly maxUses: Option.Option<number>;
    readonly maxUsesPerCustomer: Option.Option<number>;
    readonly validFrom: Option.Option<
      NonNullable<CreateCodeMutation["code"]["validFrom"]>
    >;
    readonly validUntil: Option.Option<
      NonNullable<CreateCodeMutation["code"]["validUntil"]>
    >;
  },
  discount: CreateCodeMutation["discount"]
): AdministrationDiscountMutationType => {
  const code: CreateCodeMutation["code"] = {
    code: input.code,
    enabled: !input.disabled,
    maxUses: Option.getOrNull(input.maxUses),
    maxUsesPerCustomer: Option.getOrNull(input.maxUsesPerCustomer),
    validFrom: Option.getOrNull(input.validFrom),
    validUntil: Option.getOrNull(input.validUntil),
  };
  return Option.match(input.customer, {
    onNone: (): CreateCodeMutation => ({ kind: "create-code", code, discount }),
    onSome: (customerId): CreateCustomerCodeMutation => ({
      kind: "create-customer-code",
      customerId,
      code,
      discount,
    }),
  });
};

const runDiscountMutation = (mutation: AdministrationDiscountMutationType) =>
  runAuthenticatedCommand((api, accessToken, json) =>
    executeAndReportDiscountMutation(api, accessToken, json, mutation)
  );

const runConfirmedDiscountMutation = ({
  confirmation,
  mutation,
  yes,
}: {
  readonly confirmation: string;
  readonly mutation: AdministrationDiscountMutationType;
  readonly yes: boolean;
}) =>
  runAuthenticatedCommand((api, accessToken, json) =>
    Effect.gen(function* () {
      const confirmed = yield* confirmChange(yes, json, confirmation);
      if (!confirmed) {
        yield* reportCancellation(json);
        return;
      }
      yield* executeAndReportDiscountMutation(api, accessToken, json, mutation);
    })
  );

const runConfirmedReservationAccessMutation = ({
  confirmation,
  mutation,
  providerCredentialRemoved,
  reservationId,
  yes,
}: {
  readonly confirmation: string;
  readonly mutation: AdministrationReservationAccessMutationType;
  readonly providerCredentialRemoved?: boolean;
  readonly reservationId: AdministrationWorkspaceReservationIdType;
  readonly yes: boolean;
}) =>
  runAuthenticatedCommand((api, accessToken, json) =>
    Effect.gen(function* () {
      if (providerCredentialRemoved === false) {
        return yield* new InvalidMutationInputError({
          message:
            "Verify the credential in Igloohome, then pass --provider-credential-removed.",
        });
      }
      const confirmed = yield* confirmChange(yes, json, confirmation);
      if (!confirmed) {
        yield* reportCancellation(json);
        return;
      }
      const crypto = yield* Crypto.Crypto;
      const requestId = CliMutationRequestId.make(yield* crypto.randomUUIDv7);
      const grant = yield* api.mutateReservationAccess(
        accessToken,
        requestId,
        reservationId,
        mutation
      );
      yield* Console.log(
        json ? JSON.stringify(grant) : formatReservationAccessGrant(grant)
      );
    })
  );

const executeAndReportDiscountMutation = (
  api: WorkspaceAdminApiClient["Service"],
  accessToken: Redacted.Redacted<CliAccessTokenType>,
  json: boolean,
  mutation: AdministrationDiscountMutationType
) =>
  Effect.gen(function* () {
    const validatedMutation = yield* Schema.decodeUnknownEffect(
      AdministrationDiscountMutation
    )(mutation).pipe(
      Effect.mapError(
        () =>
          new InvalidMutationInputError({
            message:
              "The mutation input is invalid. Check date ranges and repeated product options.",
          })
      )
    );
    const crypto = yield* Crypto.Crypto;
    const requestId = CliMutationRequestId.make(yield* crypto.randomUUIDv7);
    const result = yield* api.mutateDiscounts(
      accessToken,
      requestId,
      validatedMutation
    );
    yield* Console.log(
      json ? JSON.stringify(result) : formatMutationResult(result)
    );
  });

const formatMutationResult = (
  result: AdministrationDiscountMutationResultType
) => {
  const notice = Match.value(result.kind).pipe(
    Match.when("create-discount", () => "Discount created."),
    Match.when("update-discount", () => "Discount updated."),
    Match.when("delete-discount", () => "Discount deleted."),
    Match.when("create-code", () => "Discount code created."),
    Match.when("create-customer-code", () => "Customer code created."),
    Match.when("update-code", () => "Discount code updated."),
    Match.when("delete-code", () => "Discount code deleted."),
    Match.when("add-code-customer", () => "Customer added to code audience."),
    Match.when(
      "remove-code-customer",
      () => "Customer removed from code audience."
    ),
    Match.when("make-code-unrestricted", () => "Code made unrestricted."),
    Match.when("create-voucher", () => "Voucher created."),
    Match.when("create-customer-voucher", () => "Customer voucher created."),
    Match.when("update-voucher", () => "Voucher updated."),
    Match.when("delete-voucher", () => "Voucher deleted."),
    Match.when(
      "add-voucher-customer",
      () => "Customer added to voucher audience."
    ),
    Match.when(
      "remove-voucher-customer",
      () => "Customer removed from voucher audience."
    ),
    Match.when("make-voucher-unrestricted", () => "Voucher made unrestricted."),
    Match.when(
      "set-customer-discount-group",
      () => "Customer discount group updated."
    ),
    Match.exhaustive
  );
  const createdId =
    result.createdDiscountId ?? result.createdCodeId ?? result.createdVoucherId;
  return createdId === null ? notice : `${notice} ${createdId}`;
};

const confirmChange = (yes: boolean, json: boolean, message: string) => {
  if (yes) return Effect.succeed(true);
  if (json || process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    return new ConfirmationRequiredError({
      message: "Confirmation is required. Pass --yes to apply this change.",
    });
  }
  return Prompt.confirm({ message, initial: false }).pipe(Prompt.run);
};

const reportCancellation = (json: boolean) =>
  Console.log(json ? JSON.stringify({ status: "cancelled" }) : "Cancelled.");

const formatOverviewMetric = (
  label: string,
  metric: AdministrationOverviewMetricType
) =>
  `${label}: ${metric.unavailable ? "unavailable" : `${metric.completed} / ${metric.value}`}`;

const formatReservationRow = (
  reservation: AdministrationReservationSummaryType
) =>
  [
    reservation.id,
    reservation.date ?? reservation.startsAt ?? "Unknown",
    reservation.typeLabel,
    reservation.customer?.displayName ?? reservation.customerId,
    reservation.status.label,
  ].join("\t");

const formatReservationAccessGrant = (
  grant: AdministrationReservationAccessGrantType
) =>
  `Access: ${grant.state} · ${grant.startsAt}–${grant.endsAt} · ${grant.accessName}`;

const formatDiscountAdjustment = (
  adjustment: AdministrationDiscountAdjustmentType
) =>
  adjustment.kind === "percentage"
    ? `${adjustment.basisPoints / 100}%`
    : formatMoney(adjustment.amount);

const offerAutomaticUpdate = (json: boolean) =>
  Effect.gen(function* () {
    const config = yield* DhwConfig;

    if (
      json ||
      config.isCi ||
      process.stdin.isTTY !== true ||
      process.stdout.isTTY !== true
    ) {
      return;
    }

    const updateService = yield* UpdateService;
    const available = yield* updateService
      .check(false)
      .pipe(Effect.orElseSucceed(() => Option.none<AvailableUpdate>()));

    if (Option.isNone(available)) return;

    const shouldInstall = yield* confirmUpdate(available.value);
    if (shouldInstall) {
      yield* installAndReport(available.value, false);
    }
  });

const confirmUpdate = (update: AvailableUpdate) =>
  Prompt.confirm({
    message: `Update dhw ${DHW_VERSION} to ${update.version}?`,
    initial: true,
  }).pipe(Prompt.run);

const installAndReport = (update: AvailableUpdate, json: boolean) =>
  Effect.gen(function* () {
    const updateService = yield* UpdateService;
    yield* updateService.install(update);
    yield* Console.log(
      json
        ? JSON.stringify({ status: "updated", version: update.version })
        : `Updated dhw to ${update.version}.`
    );
  });
