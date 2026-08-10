import {
  type AdministrationBookingQueryType,
  type AdministrationCustomerQueryType,
  type AdministrationDiscountAdjustmentType,
  type AdministrationOperationQueryType,
  type AdministrationOrderQueryType,
  type AdministrationOverviewMetricType,
  type AdministrationReservationQueryType,
  type AdministrationReservationSummaryType,
  type CliAccessTokenType,
  CliSessionUnauthorized,
  makeCliAuthenticationChallenge,
  makeCliAuthenticationVerifier,
} from "@deskohub/workspace-admin-api";
import { Console, Data, Effect, Option, type Redacted } from "effect";
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
        const query: AdministrationReservationQueryType = {
          ...(Option.isSome(customer) && { customerId: customer.value }),
          ...(Option.isSome(date) && { date: date.value }),
          ...(Option.isSome(direction) && { direction: direction.value }),
          ...(Option.isSome(page) && { page: page.value }),
          ...(Option.isSome(sort) && { sort: sort.value }),
          ...(Option.isSome(status) && { status: status.value }),
          ...(Option.isSome(type) && { type: type.value }),
        };
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
  { reservationId: Argument.string("reservation-id") },
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

const reservationsCommand = Command.make("reservations").pipe(
  Command.withDescription("Inspect Workspace reservations"),
  Command.withSubcommands([
    reservationsListCommand,
    reservationsGetCommand,
    reservationsFindCommand,
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
        const detail = yield* api.getBooking(accessToken, bookingId);
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

const ordersListCommand = Command.make(
  "list",
  administrationDateRangeFlags,
  ({ from, to }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const query: AdministrationOrderQueryType = {
          ...(Option.isSome(from) && { from: from.value }),
          ...(Option.isSome(to) && { to: to.value }),
        };
        const result = yield* api.listOrders(accessToken, query);
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
).pipe(Command.withDescription("List payment provider orders"));

const ordersGetCommand = Command.make(
  "get",
  { orderId: Argument.string("order-id") },
  ({ orderId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const order = yield* api.getOrder(accessToken, orderId);
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
).pipe(Command.withDescription("Show a payment provider order"));

const ordersCommand = Command.make("orders").pipe(
  Command.withDescription("Inspect payment provider orders"),
  Command.withSubcommands([ordersListCommand, ordersGetCommand])
);

const operationsListCommand = Command.make(
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
        const query: AdministrationOperationQueryType = {
          ...(Option.isSome(from) && { from: from.value }),
          ...(Option.isSome(to) && { to: to.value }),
          ...(Option.isSome(channel) && { channel: channel.value }),
          ...(Option.isSome(operationType) && {
            operationType: operationType.value,
          }),
        };
        const result = yield* api.listOperations(accessToken, query);
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
).pipe(Command.withDescription("List payment provider operations"));

const operationsGetCommand = Command.make(
  "get",
  { operationId: Argument.string("operation-id") },
  ({ operationId }) =>
    runAuthenticatedCommand((api, accessToken, json) =>
      Effect.gen(function* () {
        const detail = yield* api.getOperation(accessToken, operationId);
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
).pipe(Command.withDescription("Show a payment provider operation"));

const operationsCommand = Command.make("operations").pipe(
  Command.withDescription("Inspect payment provider operations"),
  Command.withSubcommands([operationsListCommand, operationsGetCommand])
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
        const detail = yield* api.getCustomer(accessToken, customerId);
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
        const result = yield* api.listCustomerReservations(
          accessToken,
          customerId,
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

const customersCommand = Command.make("customers").pipe(
  Command.withDescription("Inspect Workspace customers"),
  Command.withSubcommands([
    customersListCommand,
    customersSearchCommand,
    customersGetCommand,
    customersReservationsCommand,
  ])
);

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
  Command.withDescription("Inspect managed discounts"),
  Command.withSubcommands([discountsListCommand])
);

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
            discountLabels.get(code.discountId) ?? code.discountId,
            code.enabled ? "Enabled" : "Disabled",
            code.remainingUses ?? "Unlimited",
          ].join("\t")
        );
      }
    })
  )
).pipe(Command.withDescription("List managed discount codes"));

const codesGetCommand = Command.make(
  "get",
  { codeId: Argument.string("code-id") },
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
            detail.code.remainingUses ?? "Unlimited uses",
          ].join("\t")
        );
        yield* Console.log(
          `${detail.customers.length} customers · ${detail.claims.length} claims`
        );
      })
    )
).pipe(Command.withDescription("Show a discount code and its claims"));

const codesCommand = Command.make("codes").pipe(
  Command.withDescription("Inspect managed discount codes"),
  Command.withSubcommands([codesListCommand, codesGetCommand])
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

const sessionsCommand = Command.make("sessions").pipe(
  Command.withDescription("Inspect CLI sessions"),
  Command.withSubcommands([sessionsListCommand])
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
    operationsCommand,
    ordersCommand,
    overviewCommand,
    reservationsCommand,
    salesCommand,
    sessionsCommand,
    updateCommand,
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
    json: boolean
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
      return yield* operation(api, current.value.accessToken, json).pipe(
        Effect.tapError((cause) =>
          cause instanceof CliSessionUnauthorized
            ? authentication.clear.pipe(Effect.asVoid)
            : Effect.void
        )
      );
    })
  );

const formatOverviewMetric = (
  label: string,
  metric: AdministrationOverviewMetricType
) => `${label}: ${metric.unavailable ? "unavailable" : metric.value}`;

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

const formatDiscountAdjustment = (
  adjustment: AdministrationDiscountAdjustmentType
) =>
  adjustment.kind === "percentage"
    ? `${adjustment.basisPoints / 100}%`
    : `${adjustment.amount.value / 10 ** adjustment.amount.exponent} ${adjustment.amount.currency}`;

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
