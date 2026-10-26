import "server-only";

import { Effect, Layer } from "effect";
import {
  AdministrationRecordNotFound,
  runAdministrationPage,
} from "@/features/administrators/server/administration-request.server";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type { DiscountCodeId, VoucherId } from "../persistence-contracts";
import { formatDiscountAdminCustomerName } from "./customer-display-name";
import {
  DiscountAdministration,
  type DiscountAdminNotFoundError,
} from "./discount-administration.service";

export type DiscountAdminSearchParams = Promise<{
  readonly notice?: string;
  readonly status?: string;
}>;

type DiscountAdministrationQuery<A, E> = (
  administration: DiscountAdministration["Service"]
) => Effect.Effect<A, E>;

/** Runs a discounts page query against the discount administration. */
const runDiscountAdministration = <A, E>(
  operation: string,
  query: DiscountAdministrationQuery<A, E | AdministrationRecordNotFound>
) =>
  runAdministrationPage(
    operation,
    Effect.gen(function* () {
      return yield* query(yield* DiscountAdministration);
    }),
    DiscountAdministration.Live
  );

/**
 * Runs a discounts page query for one record. A record that doesn't exist
 * answers the page with the ordinary 404.
 */
const runDiscountAdminRecordPage = <A, E>(
  operation: string,
  query: DiscountAdministrationQuery<A, E | DiscountAdminNotFoundError>
) =>
  runDiscountAdministration(operation, (administration) =>
    query(administration).pipe(
      Effect.catchTag("DiscountAdminNotFoundError", () =>
        Effect.fail(new AdministrationRecordNotFound())
      )
    )
  );

const isNoticeStatus = (
  status: string | undefined
): status is "error" | "success" => status === "success" || status === "error";

const readNotice = (searchParams: DiscountAdminSearchParams) =>
  Effect.promise(() => searchParams).pipe(
    Effect.map(({ notice, status }) =>
      notice && isNoticeStatus(status) ? { message: notice, status } : undefined
    )
  );

export const loadDiscountAdminPageData = (
  searchParams: DiscountAdminSearchParams
) =>
  runDiscountAdministration("discount-administration.load", (administration) =>
    Effect.all(
      {
        dashboard: administration.loadDashboard(),
        notice: readNotice(searchParams),
      },
      { concurrency: "unbounded" }
    )
  );

export const loadDiscountAdminCodesPageData = (
  searchParams: DiscountAdminSearchParams
) =>
  runDiscountAdministration(
    "discount-administration.load-codes",
    (administration) =>
      Effect.all(
        {
          dashboard: administration.loadCodesPage(),
          notice: readNotice(searchParams),
        },
        { concurrency: "unbounded" }
      )
  );

export const loadDiscountAdminSalesPageData = (
  searchParams: DiscountAdminSearchParams
) =>
  runDiscountAdministration(
    "discount-administration.load-sales",
    (administration) =>
      Effect.all(
        {
          dashboard: administration.loadSalesPage(),
          notice: readNotice(searchParams),
        },
        { concurrency: "unbounded" }
      )
  );

export const loadDiscountAdminVouchersPageData = (
  searchParams: DiscountAdminSearchParams
) =>
  runDiscountAdministration(
    "discount-administration.load-vouchers",
    (administration) =>
      Effect.all(
        {
          dashboard: administration.loadVouchersPage(),
          notice: readNotice(searchParams),
        },
        { concurrency: "unbounded" }
      )
  );

export const loadDiscountAdminShellPageData = (
  searchParams: DiscountAdminSearchParams
) =>
  runAdministrationPage(
    "discount-administration.load-shell",
    Effect.all({ notice: readNotice(searchParams) }),
    Layer.empty
  );

export const loadDiscountAdminCodePageData = (
  codeId: DiscountCodeId,
  searchParams: DiscountAdminSearchParams
) =>
  runDiscountAdminRecordPage(
    "discount-administration.load-code",
    (administration) =>
      Effect.all(
        {
          detail: administration.loadCodeDetail({ codeId }),
          notice: readNotice(searchParams),
        },
        { concurrency: "unbounded" }
      )
  );

export const loadDiscountAdminCustomerPageData = (
  customerId: DotyposCustomerId,
  searchParams: DiscountAdminSearchParams
) =>
  runDiscountAdminRecordPage(
    "discount-administration.load-customer",
    (administration) =>
      Effect.all(
        {
          profile: administration.loadCustomerProfile({ customerId }),
          notice: readNotice(searchParams),
        },
        { concurrency: "unbounded" }
      )
  );

export const loadDiscountAdminVoucherPageData = (
  voucherId: VoucherId,
  searchParams: DiscountAdminSearchParams
) =>
  runDiscountAdminRecordPage(
    "discount-administration.load-voucher",
    (administration) =>
      Effect.all(
        {
          detail: administration.loadVoucherDetail({ voucherId }),
          notice: readNotice(searchParams),
        },
        { concurrency: "unbounded" }
      )
  );

export const loadDiscountAdminCustomerCodeCreationPageData = (
  customerId: DotyposCustomerId
) =>
  runDiscountAdminRecordPage(
    "discount-administration.load-customer-code-creation",
    (administration) => administration.loadCustomerCodeCreation({ customerId })
  );

export const loadDiscountAdminCustomerVoucherCreationPageData = (
  customerId: DotyposCustomerId
) =>
  runDiscountAdminRecordPage(
    "discount-administration.load-customer-voucher-creation",
    (administration) =>
      administration.loadCustomerVoucherCreation({ customerId })
  );

/**
 * The customer page without a 404: a customer the discount administration
 * can't read still shows their workspace activity.
 */
export const loadOptionalDiscountAdminCustomerPageData = (
  customerId: DotyposCustomerId,
  searchParams: DiscountAdminSearchParams
) =>
  runDiscountAdministration(
    "discount-administration.load-customer-optional",
    (administration) =>
      Effect.all(
        {
          profile: administration.loadCustomerProfile({ customerId }).pipe(
            Effect.catchTag("DiscountAdminNotFoundError", () =>
              Effect.succeed(null)
            ),
            Effect.catch((cause) =>
              Effect.logWarning("Customer administration details unavailable", {
                cause,
                customerId,
              }).pipe(Effect.as(null))
            )
          ),
          notice: readNotice(searchParams),
        },
        { concurrency: "unbounded" }
      )
  );

export const loadDiscountAdminCustomerBreadcrumbLabel = (
  customerId: DotyposCustomerId,
  locale: Locale
) =>
  runAdministrationPage(
    "discount-administration.customer-breadcrumb",
    Effect.gen(function* () {
      const administration = yield* DiscountAdministration;
      const customer = yield* administration.loadCustomerBreadcrumbLabel({
        customerId,
      });
      return formatDiscountAdminCustomerName(customer, locale);
    }).pipe(
      // The label falls back to the route segment even when the discount
      // administration itself can't start.
      Effect.provide(DiscountAdministration.Live),
      Effect.catch((cause) =>
        Effect.logWarning("Customer breadcrumb label unavailable", {
          cause,
          customerId,
        }).pipe(Effect.as(undefined))
      )
    ),
    Layer.empty
  );
