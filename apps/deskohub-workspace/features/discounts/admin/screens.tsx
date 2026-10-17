import { type ReactNode, Suspense } from "react";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import {
  AdministrationActionLoading,
  AdministrationCollectionLoading,
  AdministrationCountLoading,
  AdministrationDetailLoading,
} from "@/features/administration/loading";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import {
  CodesAdministrationActions,
  CodesAdministrationCollection,
  SalesAdministrationActions,
  SalesAdministrationCollection,
  VouchersAdministrationActions,
  VouchersAdministrationCollection,
} from "./components";
import type {
  loadDiscountAdminCodesPageData,
  loadDiscountAdminSalesPageData,
  loadDiscountAdminVouchersPageData,
} from "./page-data.server";

// Each screen awaits only the route locale, which the prerender already
// knows, so its frame stays in the instant shell while data streams through
// the Suspense boundaries.

type CodesData = Awaited<ReturnType<typeof loadDiscountAdminCodesPageData>>;

export async function DiscountCodesAdministrationScreen({
  data,
}: {
  readonly data: Promise<CodesData>;
}) {
  const locale = await getRequestLocale();

  return (
    <AdministrationPage>
      <h1 className="sr-only">{m.discountsCodesTitle({}, { locale })}</h1>
      <Suspense fallback={null}>
        <CodesNotice data={data} />
      </Suspense>
      <AdministrationTableToolbar
        actions={
          <Suspense
            fallback={
              <AdministrationActionLoading
                label={m.discountsCodesLoadingActions({}, { locale })}
              />
            }
          >
            <CodesActions data={data} />
          </Suspense>
        }
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading
                label={m.discountsCodesLoadingCount({}, { locale })}
              />
            }
          >
            <CodesCount data={data} locale={locale} />
          </Suspense>
        }
        label={m.discountsCodesTableControls({}, { locale })}
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            columns={6}
            label={m.discountsCodesLoadingCollection({}, { locale })}
          />
        }
      >
        <CodesCollection data={data} locale={locale} />
      </Suspense>
    </AdministrationPage>
  );
}

async function CodesNotice({ data }: { readonly data: Promise<CodesData> }) {
  return <AdministrationNoticeBanner notice={(await data).notice} />;
}

async function CodesActions({ data }: { readonly data: Promise<CodesData> }) {
  return <CodesAdministrationActions dashboard={(await data).dashboard} />;
}

async function CodesCount({
  data,
  locale,
}: {
  readonly data: Promise<CodesData>;
  readonly locale: Locale;
}) {
  const count = (await data).dashboard.codes.length;
  return (
    <AdministrationTableCount
      count={count}
      label={m.discountsCodesCount({ count }, { locale })}
    />
  );
}

async function CodesCollection({
  data,
  locale,
}: {
  readonly data: Promise<CodesData>;
  readonly locale: Locale;
}) {
  return (
    <CodesAdministrationCollection
      dashboard={(await data).dashboard}
      locale={locale}
    />
  );
}

type VouchersData = Awaited<
  ReturnType<typeof loadDiscountAdminVouchersPageData>
>;

export async function VouchersAdministrationScreen({
  data,
}: {
  readonly data: Promise<VouchersData>;
}) {
  const locale = await getRequestLocale();

  return (
    <AdministrationPage>
      <h1 className="sr-only">
        {m.discountsVouchersPageTitle({}, { locale })}
      </h1>
      <Suspense fallback={null}>
        <VouchersNotice data={data} />
      </Suspense>
      <AdministrationTableToolbar
        actions={
          <Suspense
            fallback={
              <AdministrationActionLoading
                label={m.discountsVouchersLoadingActions({}, { locale })}
              />
            }
          >
            <VouchersAdministrationActions />
          </Suspense>
        }
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading
                label={m.discountsVouchersLoadingCount({}, { locale })}
              />
            }
          >
            <VouchersCount data={data} locale={locale} />
          </Suspense>
        }
        label={m.discountsVouchersTableControls({}, { locale })}
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            columns={6}
            label={m.discountsVouchersLoadingCollection({}, { locale })}
          />
        }
      >
        <VouchersCollection data={data} locale={locale} />
      </Suspense>
    </AdministrationPage>
  );
}

async function VouchersNotice({
  data,
}: {
  readonly data: Promise<VouchersData>;
}) {
  return <AdministrationNoticeBanner notice={(await data).notice} />;
}

async function VouchersCount({
  data,
  locale,
}: {
  readonly data: Promise<VouchersData>;
  readonly locale: Locale;
}) {
  const count = (await data).dashboard.vouchers.length;
  return (
    <AdministrationTableCount
      count={count}
      label={m.discountsVouchersCount({ count }, { locale })}
    />
  );
}

async function VouchersCollection({
  data,
  locale,
}: {
  readonly data: Promise<VouchersData>;
  readonly locale: Locale;
}) {
  return (
    <VouchersAdministrationCollection
      dashboard={(await data).dashboard}
      locale={locale}
    />
  );
}

type SalesData = Awaited<ReturnType<typeof loadDiscountAdminSalesPageData>>;

export async function SalesAdministrationScreen({
  data,
}: {
  readonly data: Promise<SalesData>;
}) {
  const locale = await getRequestLocale();

  return (
    <AdministrationPage>
      <h1 className="sr-only">{m.discountsSalesTitle({}, { locale })}</h1>
      <Suspense fallback={null}>
        <SalesNotice data={data} />
      </Suspense>
      <AdministrationTableToolbar
        actions={<SalesAdministrationActions />}
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading
                label={m.discountsSalesLoadingCount({}, { locale })}
              />
            }
          >
            <SalesCount data={data} locale={locale} />
          </Suspense>
        }
        label={m.discountsSalesTableControls({}, { locale })}
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            columns={6}
            label={m.discountsSalesLoadingCollection({}, { locale })}
          />
        }
      >
        <SalesCollection data={data} locale={locale} />
      </Suspense>
    </AdministrationPage>
  );
}

async function SalesNotice({ data }: { readonly data: Promise<SalesData> }) {
  return <AdministrationNoticeBanner notice={(await data).notice} />;
}

async function SalesCount({
  data,
  locale,
}: {
  readonly data: Promise<SalesData>;
  readonly locale: Locale;
}) {
  const count = (await data).dashboard.calendar.events.length;
  return (
    <AdministrationTableCount
      count={count}
      label={m.discountsSalesCount({ count }, { locale })}
    />
  );
}

async function SalesCollection({
  data,
  locale,
}: {
  readonly data: Promise<SalesData>;
  readonly locale: Locale;
}) {
  return (
    <SalesAdministrationCollection
      dashboard={(await data).dashboard}
      locale={locale}
    />
  );
}

export async function CustomerDiscountCodeCreationScreen({
  children,
}: {
  readonly children: ReactNode;
}) {
  const locale = await getRequestLocale();

  return (
    <AdministrationPage>
      <Suspense
        fallback={
          <AdministrationDetailLoading
            label={m.discountsCustomerCodeCreateLoading({}, { locale })}
          />
        }
      >
        {children}
      </Suspense>
    </AdministrationPage>
  );
}

export async function CustomerVoucherCreationScreen({
  children,
}: {
  readonly children: ReactNode;
}) {
  const locale = await getRequestLocale();

  return (
    <AdministrationPage>
      <Suspense
        fallback={
          <AdministrationDetailLoading
            label={m.discountsCustomerVoucherCreateLoading({}, { locale })}
          />
        }
      >
        {children}
      </Suspense>
    </AdministrationPage>
  );
}
