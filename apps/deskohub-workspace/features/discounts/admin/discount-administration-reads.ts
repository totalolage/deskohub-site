import {
  DotyposCustomerIdSchema,
  DotyposDiscountGroupIdSchema,
  DotyposService,
} from "@deskohub/dotypos";
import type {
  Customer as DotyposCustomer,
  DiscountGroup as DotyposDiscountGroup,
} from "@deskohub/dotypos/generated";
import {
  type GoogleCalendarEventId,
  type GoogleCalendarICalUid,
  GoogleCalendarService,
} from "@deskohub/google-calendar";
import { Effect, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type {
  DiscountCode,
  DiscountCodeClaimState,
  DiscountCodeRedemption,
  DiscountProductTarget,
  PromotionCode,
  StoredDiscount,
  Voucher,
  VoucherRedemption,
} from "@/db/schema";
import { unnamedCustomerDisplayName } from "@/features/administration/customer-name";
import { listDiscountGroups } from "@/features/discounts/discount-groups";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  CalendarResourceConfig,
  type SalesCalendarId,
} from "@/shared/backend/config/calendar-resource.config";
import { workspaceSiteConstants } from "@/shared/utils";
import type { DiscountAdjustment } from "../contracts";
import { toDotyposDiscountBasisPoints } from "../dotypos-discount-percentage";
import {
  type DiscountCodeId,
  storedDiscountIdSchema,
  type VoucherId,
} from "../persistence-contracts";
import { untitledCalendarEventTitle } from "./calendar-sale-title";
import type { DiscountAdminCustomerSearch } from "./contracts";
import type {
  AdminCalendarSale,
  AdminCustomerSearchResult,
  AdminDiscount,
  AdminDiscountCode,
  AdminDiscountCodeClaim,
  AdminDiscountGroup,
  AdminDotyposCustomer,
  AdminVoucher,
  AdminVoucherClaim,
} from "./discount-administration.service";
import { DiscountAdminNotFoundError } from "./discount-administration-errors";

/**
 * The read side of `DiscountAdministration`: page loads and the Dotypos and
 * Google Calendar lookups behind them. Detail pages read audience customers
 * from Dotypos side by side, which no file that opens transactions may state,
 * so the reads live apart from the service's mutation transactions. Every read
 * here runs outside a transaction.
 */
export const makeDiscountAdministrationReads = Effect.gen(function* () {
  const { db } = yield* WorkspaceDatabase;
  const calendar = yield* GoogleCalendarService;
  const dotypos = yield* DotyposService;
  const { salesCalendarId } = yield* CalendarResourceConfig;

  const loadActiveCustomer = Effect.fn(
    "DiscountAdministration.loadActiveCustomer"
  )((customerId: DotyposCustomerId) =>
    dotypos.getCustomer(customerId).pipe(
      Effect.map(
        Option.filter((customer) => Boolean(customer.id) && !customer.deleted)
      ),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new DiscountAdminNotFoundError({
                resource: { kind: "Dotypos customer", id: customerId },
                message: "The Dotypos customer does not exist or is deleted.",
              })
            ),
          onSome: Effect.succeed,
        })
      )
    )
  );

  const loadDiscounts = Effect.fn("DiscountAdministration.loadDiscounts")(() =>
    db.query.discounts
      .findMany({
        with: {
          codes: {},
          productTargets: {},
        },
      })
      .pipe(
        Effect.map((rows) =>
          rows
            .map(toAdminDiscount)
            .toSorted((left, right) =>
              (left.labels["en-US"] ?? "").localeCompare(
                right.labels["en-US"] ?? ""
              )
            )
        )
      )
  );

  const loadCodes = Effect.fn("DiscountAdministration.loadCodes")(() =>
    db.query.discountCodes
      .findMany({
        with: {
          promotion: { with: { customers: {} } },
          redemptions: { with: { application: {} } },
        },
      })
      .pipe(
        Effect.map((rows) =>
          rows
            .map(toAdminDiscountCode)
            .toSorted((left, right) => left.code.localeCompare(right.code))
        )
      )
  );

  const loadVouchers = Effect.fn("DiscountAdministration.loadVouchers")(() =>
    db.query.vouchers
      .findMany({
        with: {
          promotion: { with: { customers: {} } },
          redemptions: { with: { application: {} } },
        },
      })
      .pipe(
        Effect.map((rows) =>
          rows
            .map(toAdminVoucher)
            .toSorted((left, right) => left.code.localeCompare(right.code))
        )
      )
  );

  const loadCodesPage = Effect.fn("DiscountAdministration.loadCodesPage")(() =>
    Effect.all(
      {
        codes: loadCodes(),
        discounts: loadDiscounts(),
      },
      { concurrency: 2 }
    )
  );

  const loadVouchersPage = Effect.fn("DiscountAdministration.loadVouchersPage")(
    () => loadVouchers().pipe(Effect.map((vouchers) => ({ vouchers })))
  );

  const loadSalesPage = Effect.fn("DiscountAdministration.loadSalesPage")(() =>
    loadDiscounts().pipe(
      Effect.flatMap((discounts) =>
        loadCalendarDashboard({
          calendar,
          discounts,
          salesCalendarId,
        }).pipe(Effect.map((calendar) => ({ calendar, discounts })))
      )
    )
  );

  const loadDashboard = Effect.fn("DiscountAdministration.loadDashboard")(() =>
    Effect.all({
      codesPage: loadCodesPage(),
      vouchers: loadVouchers(),
    }).pipe(
      Effect.map(({ codesPage, vouchers }) => ({
        ...codesPage,
        vouchers,
      })),
      Effect.bind("calendar", ({ discounts }) =>
        loadCalendarDashboard({
          calendar,
          discounts,
          salesCalendarId,
        })
      ),
      Effect.map(({ calendar, codes, discounts, vouchers }) => ({
        calendar,
        codes,
        discounts,
        vouchers,
      }))
    )
  );

  const loadCodeDetail = Effect.fn("DiscountAdministration.loadCodeDetail")(
    (input: { readonly codeId: DiscountCodeId }) =>
      db.query.discountCodes
        .findFirst({
          where: { id: { eq: input.codeId } },
          with: {
            promotion: { with: { customers: {} } },
            discount: {},
            redemptions: {
              with: {
                application: {},
              },
            },
          },
        })
        .pipe(
          Effect.flatMap((row) =>
            row
              ? Effect.succeed(row)
              : Effect.fail(
                  new DiscountAdminNotFoundError({
                    resource: {
                      kind: "discount code",
                      id: input.codeId,
                    },
                    message: "The discount code no longer exists.",
                  })
                )
          ),
          Effect.bindTo("row"),
          Effect.bind("customers", ({ row }) =>
            Effect.forEach(
              row.promotion.customers,
              ({ dotyposCustomerId }) =>
                dotypos.getCustomer(dotyposCustomerId).pipe(
                  Effect.map(
                    Option.match({
                      onNone: () => null,
                      onSome: toAdminDotyposCustomer,
                    })
                  ),
                  Effect.orElseSucceed(() => null),
                  Effect.map((customer) => ({
                    customerId: dotyposCustomerId,
                    customer,
                  }))
                ),
              { concurrency: 5 }
            )
          ),
          Effect.map(({ customers, row }) => ({
            code: toAdminDiscountCode(row),
            discountLabel: row.discount.labels["en-US"],
            discountLabels: row.discount.labels,
            customers,
            claims: row.redemptions
              .map(toAdminDiscountCodeClaim)
              .toSorted((left, right) =>
                Temporal.Instant.compare(right.reservedAt, left.reservedAt)
              ),
          }))
        )
  );

  const loadVoucherDetail = Effect.fn(
    "DiscountAdministration.loadVoucherDetail"
  )((input: { readonly voucherId: VoucherId }) =>
    db.query.vouchers
      .findFirst({
        where: { id: { eq: input.voucherId } },
        with: {
          promotion: { with: { customers: {} } },
          redemptions: { with: { application: {} } },
        },
      })
      .pipe(
        Effect.flatMap((row) =>
          row
            ? Effect.succeed(row)
            : Effect.fail(
                new DiscountAdminNotFoundError({
                  resource: { kind: "voucher", id: input.voucherId },
                  message: "The voucher no longer exists.",
                })
              )
        ),
        Effect.bindTo("row"),
        Effect.bind("customers", ({ row }) =>
          Effect.forEach(
            row.promotion.customers,
            ({ dotyposCustomerId }) =>
              dotypos.getCustomer(dotyposCustomerId).pipe(
                Effect.map(
                  Option.match({
                    onNone: () => null,
                    onSome: toAdminDotyposCustomer,
                  })
                ),
                Effect.orElseSucceed(() => null),
                Effect.map((customer) => ({
                  customerId: dotyposCustomerId,
                  customer,
                }))
              ),
            { concurrency: 5 }
          )
        ),
        Effect.map(({ customers, row }) => ({
          voucher: toAdminVoucher(row),
          customers,
          claims: row.redemptions
            .map(toAdminVoucherClaim)
            .toSorted((left, right) =>
              Temporal.Instant.compare(right.reservedAt, left.reservedAt)
            ),
        }))
      )
  );

  const searchCustomers = Effect.fn("DiscountAdministration.searchCustomers")(
    function* (input: DiscountAdminCustomerSearch) {
      const customers = (yield* dotypos.searchCustomers(input.query))
        .filter((customer) => customer.id && !customer.deleted)
        .map(toAdminDotyposCustomer)
        .slice(0, 50);
      let kind: AdminCustomerSearchResult["kind"] = "not-found";
      if (customers.length === 1) kind = "matched";
      else if (customers.length > 1) kind = "ambiguous";
      return {
        kind,
        customers,
      } satisfies AdminCustomerSearchResult;
    }
  );

  const loadCustomerProfile = Effect.fn(
    "DiscountAdministration.loadCustomerProfile"
  )((input: { readonly customerId: DotyposCustomerId }) =>
    Effect.all({
      customer: loadActiveCustomer(input.customerId),
      discountGroups: dotypos.getDiscountGroups(),
      codeRows: db.query.discountCodes.findMany({
        with: {
          promotion: { with: { customers: {} } },
          discount: {},
          redemptions: {
            with: {
              application: {},
            },
          },
        },
      }),
      voucherRows: db.query.vouchers.findMany({
        with: {
          promotion: { with: { customers: {} } },
          redemptions: { with: { application: {} } },
        },
      }),
    }).pipe(
      Effect.map(({ codeRows, customer, discountGroups, voucherRows }) => ({
        customer: toAdminDotyposCustomer(customer),
        discountGroups: discountGroups
          .flatMap(toAdminDiscountGroup)
          .toSorted((left, right) => left.name.localeCompare(right.name)),
        codes: codeRows
          .map((row) => ({
            ...toAdminDiscountCode(row),
            discountAdjustment: toDiscountAdjustment(row.discount),
            discountLabel: row.discount.labels["en-US"],
            discountLabels: row.discount.labels,
            eligible: row.promotion.customers.some(
              ({ dotyposCustomerId }) => dotyposCustomerId === input.customerId
            ),
          }))
          .toSorted((left, right) => left.code.localeCompare(right.code)),
        claims: codeRows
          .flatMap((row) =>
            row.redemptions
              .filter(
                ({ dotyposCustomerId }) =>
                  dotyposCustomerId === input.customerId
              )
              .map(toAdminDiscountCodeClaim)
          )
          .toSorted((left, right) =>
            Temporal.Instant.compare(right.reservedAt, left.reservedAt)
          ),
        vouchers: voucherRows
          .map((row) => ({
            ...toAdminVoucher(row),
            eligible: row.promotion.customers.some(
              ({ dotyposCustomerId }) => dotyposCustomerId === input.customerId
            ),
          }))
          .toSorted((left, right) => left.code.localeCompare(right.code)),
        voucherClaims: voucherRows
          .flatMap((row) =>
            row.redemptions
              .filter(
                ({ dotyposCustomerId }) =>
                  dotyposCustomerId === input.customerId
              )
              .map(toAdminVoucherClaim)
          )
          .toSorted((left, right) =>
            Temporal.Instant.compare(right.reservedAt, left.reservedAt)
          ),
      }))
    )
  );

  const loadCustomerBreadcrumbLabel = Effect.fn(
    "DiscountAdministration.loadCustomerBreadcrumbLabel"
  )((input: { readonly customerId: DotyposCustomerId }) =>
    loadActiveCustomer(input.customerId).pipe(
      Effect.map((customer) => {
        const { displayName, hasName } = toAdminDotyposCustomer(customer);
        return { displayName, hasName };
      })
    )
  );

  const loadCustomerCodeCreation = Effect.fn(
    "DiscountAdministration.loadCustomerCodeCreation"
  )((input: { readonly customerId: DotyposCustomerId }) =>
    Effect.all(
      {
        customer: loadActiveCustomer(input.customerId),
        discounts: loadDiscounts(),
      },
      { concurrency: "inherit" }
    ).pipe(
      Effect.map(({ customer, discounts }) => ({
        customer: toAdminDotyposCustomer(customer),
        discounts: discounts.map(({ id, labels }) => ({ id, labels })),
      }))
    )
  );

  const loadCustomerVoucherCreation = Effect.fn(
    "DiscountAdministration.loadCustomerVoucherCreation"
  )((input: { readonly customerId: DotyposCustomerId }) =>
    loadActiveCustomer(input.customerId).pipe(
      Effect.map((customer) => ({
        customer: toAdminDotyposCustomer(customer),
      }))
    )
  );

  return {
    loadActiveCustomer,
    listDiscountGroups: Effect.fn("DiscountAdministration.listDiscountGroups")(
      () =>
        listDiscountGroups.pipe(Effect.provideService(DotyposService, dotypos))
    ),
    loadCodeDetail,
    loadCodesPage,
    loadCustomerBreadcrumbLabel,
    loadCustomerCodeCreation,
    loadCustomerProfile,
    loadCustomerVoucherCreation,
    loadDashboard,
    loadSalesPage,
    loadVoucherDetail,
    loadVouchersPage,
    searchCustomers,
  };
});

type AdminDiscountRow = StoredDiscount & {
  readonly productTargets: readonly DiscountProductTarget[];
  readonly codes: readonly DiscountCode[];
};

type AdminDiscountCodeRow = DiscountCode & {
  readonly promotion: PromotionCode & {
    readonly customers: readonly {
      readonly dotyposCustomerId: DotyposCustomerId;
    }[];
  };
  readonly redemptions: readonly (DiscountCodeRedemption & {
    readonly application: {
      readonly appliedAmountValue: number;
      readonly appliedAmountExponent: number;
      readonly appliedAmountCurrency: string;
    };
  })[];
};

const toAdminDiscountCode = (row: AdminDiscountCodeRow): AdminDiscountCode => {
  const usage = getAdminDiscountCodeUsage({
    maxUses: row.maxUses,
    states: row.redemptions.map(({ state }) => state),
  });
  return {
    id: row.id,
    discountId: row.discountId,
    code: String(row.promotion.code),
    enabled: row.promotion.enabled,
    validFrom: row.promotion.validFrom,
    validUntil: row.promotion.validUntil,
    maxUses: row.maxUses,
    maxUsesPerCustomer: row.maxUsesPerCustomer,
    audienceSize: row.promotion.customers.length,
    ...usage,
    createdAt: row.promotion.createdAt,
    updatedAt: row.promotion.updatedAt,
  };
};

type AdminVoucherRow = Voucher & {
  readonly promotion: PromotionCode & {
    readonly customers: readonly {
      readonly dotyposCustomerId: DotyposCustomerId;
    }[];
  };
  readonly redemptions: readonly (VoucherRedemption & {
    readonly application: {
      readonly appliedAmountValue: number;
      readonly appliedAmountExponent: number;
      readonly appliedAmountCurrency: string;
    };
  })[];
};

const toAdminVoucher = (row: AdminVoucherRow): AdminVoucher => {
  const issuedCredit = {
    value: row.issuedAmountValue,
    exponent: row.issuedAmountExponent,
    currency: row.issuedAmountCurrency,
  };
  const usedValue = row.redemptions
    .filter(({ state }) => state === "reserved" || state === "redeemed")
    .reduce((total, claim) => total + claim.application.appliedAmountValue, 0);
  const usage = getAdminDiscountCodeUsage({
    maxUses: null,
    states: row.redemptions.map(({ state }) => state),
  });
  return {
    id: row.id,
    code: String(row.promotion.code),
    enabled: row.promotion.enabled,
    validFrom: row.promotion.validFrom,
    validUntil: row.promotion.validUntil,
    issuedCredit,
    remainingCredit: {
      ...issuedCredit,
      value: Math.max(0, issuedCredit.value - usedValue),
    },
    audienceSize: row.promotion.customers.length,
    reservedUses: usage.reservedUses,
    redeemedUses: usage.redeemedUses,
    releasedUses: usage.releasedUses,
    createdAt: row.promotion.createdAt,
    updatedAt: row.promotion.updatedAt,
  };
};

export const getAdminDiscountCodeUsage = (input: {
  readonly maxUses: number | null;
  readonly states: readonly DiscountCodeClaimState[];
}) => {
  const reservedUses = input.states.filter(
    (state) => state === "reserved"
  ).length;
  const redeemedUses = input.states.filter(
    (state) => state === "redeemed"
  ).length;
  const releasedUses = input.states.filter(
    (state) => state === "released"
  ).length;

  return {
    reservedUses,
    redeemedUses,
    releasedUses,
    remainingUses:
      input.maxUses === null
        ? null
        : Math.max(0, input.maxUses - reservedUses - redeemedUses),
  };
};

export const toAdminDotyposCustomer = (
  customer: DotyposCustomer
): AdminDotyposCustomer => {
  const personName = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const name =
    customer.companyName?.trim() ||
    personName ||
    customer.email?.trim() ||
    customer.phone?.trim();

  return {
    id: Schema.decodeUnknownSync(DotyposCustomerIdSchema)(customer.id),
    displayName: name || unnamedCustomerDisplayName,
    hasName: Boolean(name),
    email: customer.email?.trim() || null,
    phone: customer.phone?.trim() || null,
    discountGroupId: Option.getOrNull(
      Schema.decodeUnknownOption(DotyposDiscountGroupIdSchema)(
        customer._discountGroupId?.trim()
      )
    ),
  };
};

const toAdminDiscountGroup = (
  group: DotyposDiscountGroup
): readonly AdminDiscountGroup[] => {
  const id = Option.getOrUndefined(
    Schema.decodeUnknownOption(DotyposDiscountGroupIdSchema)(group.id?.trim())
  );
  const basisPoints = toDotyposDiscountBasisPoints(group.discountPercent);
  if (
    !id ||
    group.deleted ||
    group.display === false ||
    basisPoints === undefined
  ) {
    return [];
  }

  return [
    {
      id,
      name: group.name?.trim() || id,
      basisPoints,
    },
  ];
};

const toAdminDiscountCodeClaim = (
  row: DiscountCodeRedemption & {
    readonly application: {
      readonly workspaceReservationId: WorkspaceReservationId;
      readonly appliedAmountValue: number;
      readonly appliedAmountExponent: number;
      readonly appliedAmountCurrency: string;
    };
  }
): AdminDiscountCodeClaim => ({
  id: row.id,
  codeId: row.codeId,
  dotyposCustomerId: row.dotyposCustomerId,
  state: row.state,
  paymentAttemptId: row.paymentAttemptId,
  workspaceReservationId: row.application.workspaceReservationId,
  appliedAmount: {
    value: row.application.appliedAmountValue,
    exponent: row.application.appliedAmountExponent,
    currency: row.application.appliedAmountCurrency,
  },
  reservationExpiresAt: row.reservationExpiresAt,
  reservedAt: row.reservedAt,
  redeemedAt: row.redeemedAt,
  releasedAt: row.releasedAt,
  releaseReason: row.releaseReason,
});

const toAdminVoucherClaim = (
  row: VoucherRedemption & {
    readonly application: {
      readonly workspaceReservationId: WorkspaceReservationId;
      readonly appliedAmountValue: number;
      readonly appliedAmountExponent: number;
      readonly appliedAmountCurrency: string;
    };
  }
): AdminVoucherClaim => ({
  id: row.id,
  voucherId: row.voucherId,
  dotyposCustomerId: row.dotyposCustomerId,
  state: row.state,
  paymentAttemptId: row.paymentAttemptId,
  workspaceReservationId: row.application.workspaceReservationId,
  appliedAmount: {
    value: row.application.appliedAmountValue,
    exponent: row.application.appliedAmountExponent,
    currency: row.application.appliedAmountCurrency,
  },
  reservationExpiresAt: row.reservationExpiresAt,
  reservedAt: row.reservedAt,
  redeemedAt: row.redeemedAt,
  releasedAt: row.releasedAt,
  releaseReason: row.releaseReason,
});

const toDiscountAdjustment = (
  row: Pick<
    StoredDiscount,
    | "fixedAmountCurrency"
    | "fixedAmountExponent"
    | "fixedAmountValue"
    | "percentageBasisPoints"
  >
): DiscountAdjustment =>
  row.percentageBasisPoints === null
    ? {
        kind: "fixed",
        amount: {
          value: row.fixedAmountValue!,
          exponent: row.fixedAmountExponent!,
          currency: row.fixedAmountCurrency!,
        },
      }
    : {
        kind: "percentage",
        basisPoints: row.percentageBasisPoints,
      };

const toAdminDiscount = (row: AdminDiscountRow): AdminDiscount => ({
  id: row.id,
  labels: row.labels,
  adjustment: toDiscountAdjustment(row),
  products: row.productTargets.map(({ productTarget }) => productTarget),
  codeCount: row.codes.length,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const loadCalendarDashboard = (input: {
  readonly calendar: GoogleCalendarService["Service"];
  readonly discounts: readonly AdminDiscount[];
  readonly salesCalendarId: SalesCalendarId;
}) => {
  const today = Temporal.Now.plainDateISO(
    workspaceSiteConstants.location.timeZone
  );
  const from = today.subtract({ days: 30 }).toString();
  const to = today.add({ years: 1 }).toString();
  const calendarUrl = `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(input.salesCalendarId)}`;

  return input.calendar
    .listEvents({
      calendarId: input.salesCalendarId,
      from,
      to,
    })
    .pipe(
      Effect.map((events) => ({
        events: events
          .map((event) =>
            toAdminCalendarSale({
              calendarUrl,
              discounts: input.discounts,
              event,
            })
          )
          .toSorted((left, right) => left.start.localeCompare(right.start)),
        unavailable: false,
        calendarUrl,
        from,
        to,
      })),
      Effect.tapError((cause) =>
        Effect.logError("Discount administration Calendar load failed", {
          cause,
        })
      ),
      Effect.orElseSucceed(() => ({
        events: [],
        unavailable: true,
        calendarUrl,
        from,
        to,
      }))
    );
};

const toAdminCalendarSale = (input: {
  readonly calendarUrl: string;
  readonly discounts: readonly AdminDiscount[];
  readonly event: {
    readonly id?: GoogleCalendarEventId;
    readonly iCalUID?: GoogleCalendarICalUid;
    readonly htmlLink?: string;
    readonly summary?: string;
    readonly description?: string;
    readonly status?: string;
    readonly start?: { readonly date?: string; readonly dateTime?: string };
    readonly end?: { readonly date?: string; readonly dateTime?: string };
  };
}): AdminCalendarSale => {
  const description = input.event.description?.trim() ?? "";
  const normalizedId = description.toLowerCase();
  const discountId = Option.getOrUndefined(
    Schema.decodeUnknownOption(storedDiscountIdSchema)(normalizedId)
  );
  const matchedDiscount = input.discounts.find(({ id }) => id === discountId);
  let association: AdminCalendarSale["association"] = {
    kind: "missing-description",
  };
  if (description.length > 0 && !discountId) {
    association = { kind: "invalid-description" };
  } else if (discountId && matchedDiscount) {
    association = {
      kind: "associated",
      discountId: matchedDiscount.id,
      discountLabel: matchedDiscount.labels["en-US"],
    };
  } else if (discountId) {
    association = { kind: "missing-discount", discountId };
  }

  return {
    eventReference: input.event.id ?? input.event.iCalUID ?? undefined,
    title: input.event.summary?.trim() || untitledCalendarEventTitle,
    description,
    start:
      input.event.start?.date ?? input.event.start?.dateTime ?? "Unknown start",
    end: input.event.end?.date ?? input.event.end?.dateTime ?? "Unknown end",
    status: input.event.status ?? "unknown",
    eventUrl: input.event.htmlLink ?? input.calendarUrl,
    association,
  };
};
