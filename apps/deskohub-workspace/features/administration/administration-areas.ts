import type { Locale } from "@/features/i18n";
import {
  type AdministrationHref,
  administrationHref,
} from "./administration-href";
import { m } from "./i18n";

/** An administration message without inputs, such as a page's label. */
export type AdministrationLabel = typeof m.shellBreadcrumbOverview;

/**
 * A segment of an administration path, usually a page, and the pages under it.
 */
type AdministrationPathSegment = {
  /**
   * The page's path, built with `administrationHref` so typecheck proves the
   * route exists. Without one, the trail extends the parent's path by the
   * encoded segment, which proves only the prefix: a record's page and the
   * pages under it, and `cli`, which has no page of its own.
   */
  readonly href?: AdministrationHref;
  readonly label: AdministrationLabel;
  /** The pages under this one, by their path segment. */
  readonly pages?: Readonly<Record<string, AdministrationPathSegment>>;
  /** The page of any one record this page lists. */
  readonly record?: AdministrationPathSegment;
};

/**
 * The administration's areas, by path segment. Each declares its collection's
 * label, its record's label, and the pages under both, such as `new`. The
 * server loads a record's own label through `recordLabelLoaders` in
 * `breadcrumb.server.tsx`.
 */
export const administrationAreas = {
  "access-codes": {
    href: administrationHref("/[locale]/admin/access-codes"),
    label: m.shellBreadcrumbAccessCodes,
  },
  administrators: {
    href: administrationHref("/[locale]/admin/administrators"),
    label: m.administratorsBreadcrumb,
  },
  bookings: {
    href: administrationHref("/[locale]/admin/bookings"),
    label: m.shellBreadcrumbBookings,
    record: { label: m.shellBreadcrumbBooking },
  },
  cli: {
    label: m.shellBreadcrumbCli,
    pages: {
      authenticate: {
        href: administrationHref("/[locale]/admin/cli/authenticate"),
        label: m.shellBreadcrumbAuthenticate,
      },
      sessions: {
        href: administrationHref("/[locale]/admin/cli/sessions"),
        label: m.shellBreadcrumbSessions,
      },
    },
  },
  codes: {
    href: administrationHref("/[locale]/admin/codes"),
    label: m.shellBreadcrumbCodes,
    record: { label: m.shellBreadcrumbCode },
  },
  customers: {
    href: administrationHref("/[locale]/admin/customers"),
    label: m.shellBreadcrumbCustomers,
    record: {
      label: m.shellBreadcrumbCustomer,
      pages: {
        "create-code": { label: m.shellBreadcrumbCreateDiscountCode },
        "create-voucher": { label: m.shellBreadcrumbCreateVoucher },
      },
    },
  },
  discounts: {
    href: administrationHref("/[locale]/admin/discounts"),
    label: m.shellBreadcrumbDiscounts,
  },
  "email-audiences": {
    href: administrationHref("/[locale]/admin/email-audiences"),
    label: m.shellBreadcrumbAudiences,
    pages: {
      new: {
        href: administrationHref("/[locale]/admin/email-audiences/new"),
        label: m.shellBreadcrumbNewAudience,
      },
    },
    record: { label: m.shellBreadcrumbAudience },
  },
  "email-campaigns": {
    href: administrationHref("/[locale]/admin/email-campaigns"),
    label: m.shellBreadcrumbCampaigns,
    pages: {
      new: {
        href: administrationHref("/[locale]/admin/email-campaigns/new"),
        label: m.shellBreadcrumbNewCampaign,
      },
    },
    record: {
      label: m.shellBreadcrumbCampaign,
      pages: {
        email: { label: m.shellBreadcrumbCampaignEmail },
        preview: { label: m.shellBreadcrumbCampaignPreview },
        recipients: { label: m.shellBreadcrumbRecipients },
        runs: {
          label: m.shellBreadcrumbCampaignRuns,
          record: { label: m.shellBreadcrumbCampaignRun },
        },
      },
    },
  },
  invoices: {
    href: administrationHref("/[locale]/admin/invoices"),
    label: m.shellBreadcrumbInvoices,
    pages: {
      new: {
        href: administrationHref("/[locale]/admin/invoices/new"),
        label: m.shellBreadcrumbNewInvoice,
      },
    },
    record: { label: m.shellBreadcrumbInvoice },
  },
  operations: {
    href: administrationHref("/[locale]/admin/operations"),
    label: m.shellBreadcrumbOperations,
    record: { label: m.shellBreadcrumbOperation },
  },
  orders: {
    href: administrationHref("/[locale]/admin/orders"),
    label: m.shellBreadcrumbOrders,
    record: { label: m.shellBreadcrumbOrder },
  },
  reservations: {
    href: administrationHref("/[locale]/admin/reservations"),
    label: m.shellBreadcrumbReservations,
    record: { label: m.shellBreadcrumbReservation },
  },
  sales: {
    href: administrationHref("/[locale]/admin/sales"),
    label: m.shellBreadcrumbSales,
  },
  vouchers: {
    href: administrationHref("/[locale]/admin/vouchers"),
    label: m.shellBreadcrumbVouchers,
    record: { label: m.shellBreadcrumbVoucher },
  },
} as const satisfies Readonly<Record<string, AdministrationPathSegment>>;

type AdministrationAreas = typeof administrationAreas;

/** An area whose collection has a page per record. */
export type AdministrationRecordArea = {
  [Area in keyof AdministrationAreas]: AdministrationAreas[Area] extends {
    readonly record: AdministrationPathSegment;
  }
    ? Area
    : never;
}[keyof AdministrationAreas];

/** The administration's overview, the root of every trail. */
export const administrationOverview = {
  href: administrationHref("/[locale]/admin"),
  label: m.shellBreadcrumbOverview,
  pages: administrationAreas,
} as const satisfies AdministrationPathSegment;

// A named page under the parent wins over its record page, as in Next routing:
// `invoices/new` is the new-invoice page, not the invoice with ID `new`.
const findPage = (
  parent: AdministrationPathSegment | undefined,
  segment: string
) => {
  const page =
    parent?.pages && Object.hasOwn(parent.pages, segment)
      ? parent.pages[segment]
      : undefined;
  return page
    ? { page, record: false }
    : parent?.record && { page: parent.record, record: true };
};

/**
 * The area and record ID a path under `/admin` names, when its second segment
 * is the area's record page rather than a named page such as `new`.
 */
export const findAdministrationRecord = (
  segments: readonly string[]
):
  | { readonly area: AdministrationRecordArea; readonly recordId: string }
  | undefined => {
  const [area, recordId] = segments;
  if (area === undefined || recordId === undefined) return undefined;
  const found = findPage(
    findPage(administrationOverview, area)?.page,
    recordId
  );
  return found?.record
    ? { area: area as AdministrationRecordArea, recordId }
    : undefined;
};

/** A link in the administration's breadcrumb trail. */
export type AdministrationCrumb = {
  readonly href: AdministrationHref;
  readonly label: string;
};

/**
 * The breadcrumb trail of a path under `/admin`, from the overview to the
 * page itself. `recordLabel` names the area's record, such as an invoice
 * number; without it, the record crumb falls back to the area's record label.
 * A segment no area declares keeps its own text.
 */
export const getAdministrationTrail = (
  segments: readonly string[],
  locale: Locale,
  recordLabel?: string
): AdministrationCrumb[] => {
  const crumbs: AdministrationCrumb[] = [
    {
      href: administrationOverview.href,
      label: administrationOverview.label({}, { locale }),
    },
  ];
  let parent: AdministrationPathSegment | undefined = administrationOverview;
  let href: AdministrationHref = administrationOverview.href;
  for (const [index, segment] of segments.entries()) {
    const found = findPage(parent, segment);
    parent = found?.page;
    href = found?.page.href ?? `${href}/${encodeURIComponent(segment)}`;
    const label =
      (index === 1 && found?.record && recordLabel) ||
      found?.page.label({}, { locale }) ||
      segment;
    crumbs.push({ href, label });
  }
  return crumbs;
};
