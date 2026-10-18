import { FilePlus2 } from "lucide-react";
import { Suspense } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  AdministrationPage,
  AdministrationPageHeader,
  AdministrationTableCount,
  AdministrationTableToolbar,
  EmptyState,
  Pagination,
} from "@/features/administration/components";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import { m } from "@/features/administration/i18n";
import { AdministrationCollectionLoading } from "@/features/administration/loading";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { Button } from "@/shared/components/ui/button";
import { formatInvoiceTotal } from "./invoice-display";
import { InvoiceAdministrationTable } from "./invoice-table";
import {
  type InvoiceAdministrationSearchParams,
  loadInvoiceAdministrationList,
} from "./page-data.server";

export async function InvoicesAdministrationScreen({
  searchParams,
}: {
  readonly searchParams: InvoiceAdministrationSearchParams;
}) {
  const locale = await getRequestLocale();
  const data = loadInvoiceAdministrationList(searchParams);
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        actions={
          <Button asChild>
            <Link href="/admin/invoices/new">
              <FilePlus2 aria-hidden className="size-4" />{" "}
              {m.accountingInvoiceListNewInvoice({}, { locale })}
            </Link>
          </Button>
        }
        description={m.accountingInvoiceListDescription({}, { locale })}
        eyebrow={m.accountingInvoiceListEyebrow({}, { locale })}
        title={m.accountingInvoiceListTitle({}, { locale })}
      />
      <Suspense fallback={null}>
        <InvoiceToolbar data={data} locale={locale} />
      </Suspense>
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            columns={8}
            label={m.accountingInvoiceListLoading({}, { locale })}
          />
        }
      >
        <InvoiceCollection data={data} locale={locale} />
      </Suspense>
    </AdministrationPage>
  );
}

type InvoiceData = Awaited<ReturnType<typeof loadInvoiceAdministrationList>>;

async function InvoiceToolbar({
  data,
  locale,
}: {
  readonly data: Promise<InvoiceData>;
  readonly locale: Locale;
}) {
  const count = (await data).items.total;
  return (
    <AdministrationTableToolbar
      count={
        <AdministrationTableCount
          count={count}
          label={m.accountingInvoiceListCount({ count }, { locale })}
        />
      }
      label={m.accountingInvoiceListTableControls({}, { locale })}
    />
  );
}

async function InvoiceCollection({
  data,
  locale,
}: {
  readonly data: Promise<InvoiceData>;
  readonly locale: Locale;
}) {
  const result = await data;
  if (result.items.items.length === 0) {
    return (
      <EmptyState message={m.accountingInvoiceListEmpty({}, { locale })} />
    );
  }
  return (
    <>
      <InvoiceAdministrationTable
        items={result.items.items.map((invoice) => ({
          ...invoice,
          issuedAtLabel: formatAdministrationDateTime(invoice.issuedAt, locale),
          totalLabel: formatInvoiceTotal(invoice, locale),
        }))}
        query={result.query}
      />
      <Pagination
        basePath="/admin/invoices"
        locale={locale}
        page={result.items.page}
        pageCount={result.items.pageCount}
        params={{ sort: result.query.sort, direction: result.query.direction }}
      />
    </>
  );
}
