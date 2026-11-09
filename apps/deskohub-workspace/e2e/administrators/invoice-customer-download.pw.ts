import { deepEqual, equal, match, ok } from "node:assert/strict";
import { type APIResponse, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { BigDecimal, Effect } from "effect";
import { invoices } from "@/db/schema/invoices";
import { getCustomerInvoiceStatusLabel } from "@/features/accounting/customer-invoice";
import { parseCsv } from "@/shared/testing/csv.test-utils";
import { extractPdfText } from "@/shared/testing/pdf-text.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { temporalInstantToPlainDate } from "@/shared/utils/temporal";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import { waitForPageUrl } from "../browser";
import { getDatasourceConfig } from "../config";
import { workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import { runtimeTest as test } from "../playwright-checkout/runtime-fixtures";
import { addRedaction } from "../redaction";
import {
  workspaceE2EAdministratorInvoiceDownloadPlaywrightTimeout,
  workspaceE2ETimeouts,
} from "../timeouts";
import { runAdministratorCase } from "./administrator-case";
import {
  makeWorkspaceE2EAdministrationIdentities,
  type WorkspaceE2EAdministrationLinkedAccount,
} from "./identities";

const caseId = "administrator-invoice-customer-download";
const locale = "en-US";
const newInvoicePath = `/${locale}/admin/invoices/new`;
const issuedInvoicePath =
  /^\/en-US\/admin\/invoices\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
// One line, so the invoice total is exactly this price.
const linePrice = "1234.50";
const lineCurrency = "CZK";

const pdfPath = (invoiceId: string) =>
  `/${locale}/account/invoices/${invoiceId}/pdf`;
const exportPath = `/${locale}/account/invoices/export`;

type IssuedInvoice = {
  readonly id: string;
  readonly invoiceNumber: string;
  /** The day in Prague it was issued, as the export writes it. */
  readonly issuedOn: string;
};

test("lets a customer download the invoice an administrator issued them as a PDF and in the CSV export, and refuses both signed out", async ({
  baseURL,
  browser,
  environment,
  runContext,
  runEffect,
}) => {
  test.setTimeout(workspaceE2EAdministratorInvoiceDownloadPlaywrightTimeout);
  const identities = makeWorkspaceE2EAdministrationIdentities<
    "aicd-admin" | "aicd-customer"
  >({
    ownerId: caseId,
    runId: runContext.runId,
    secret: resolveWorkspaceE2ESessionSigningSecret(environment),
  });
  addRedaction(environment.VERCEL_AUTOMATION_BYPASS_SECRET);
  const datasourceConfig = getDatasourceConfig(environment);
  await runEffect(
    runAdministratorCase({
      baseURL,
      browser,
      bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
      caseId,
      caseName: "administrator invoice customer download",
      timeoutMs: workspaceE2ETimeouts.administratorInvoiceDownloadCase,
      body: Effect.fn(function* (step, { origin, session }) {
        const customer = yield* step({
          execute: identities.seedLinkedCustomer(
            "aicd-customer",
            datasourceConfig
          ),
          id: "seed-linked-customer",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        });
        yield* step({
          execute: Effect.gen(function* () {
            const administrator = yield* identities.seed("aicd-admin", [
              "administrator",
            ]);
            yield* identities.signIn(administrator, { origin, session });
          }),
          id: "sign-in-seeded-administrator",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        yield* step({
          execute: session.use("open the new invoice form", async (page) => {
            await page.goto(new URL(newInvoicePath, origin).toString(), {
              timeout: workspaceE2ETimeouts.browserNavigation,
            });
            await reviewButton(page).waitFor({
              state: "visible",
              timeout: workspaceE2ETimeouts.browserNavigation,
            });
          }),
          id: "open-new-invoice-form",
          timeoutMs: workspaceE2ETimeouts.browserNavigation,
        });
        yield* step({
          execute: session.use("select the synthetic customer", (page) =>
            selectCustomer(page, customer)
          ),
          id: "select-synthetic-customer",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        });
        yield* step({
          execute: session.use("fill one paid invoice line", async (page) => {
            await page.getByLabel("Already paid").check({
              timeout: workspaceE2ETimeouts.browserAction,
            });
            await page.getByLabel("Description 1").fill("Synthetic desk", {
              timeout: workspaceE2ETimeouts.browserAction,
            });
            await page.getByLabel("Price").fill(linePrice, {
              timeout: workspaceE2ETimeouts.browserAction,
            });
            await page.getByLabel("Currency").selectOption(lineCurrency, {
              timeout: workspaceE2ETimeouts.browserAction,
            });
          }),
          id: "fill-paid-invoice-line",
          timeoutMs: workspaceE2ETimeouts.uiTransition,
        });
        // Creation is the one state-creating submission: it is sent once and
        // never retried. The invoice is journaled as soon as its id is known
        // and `read-issued-invoice` proves it names the journaled profile.
        // Its disposition is retention: the database rejects every update or
        // delete of an issued invoice, so cleanup expires the profile, keeps
        // the invoice, and has no submission to wait for.
        const invoiceId = yield* step({
          execute: Effect.gen(function* () {
            yield* session.use("issue the manual invoice", async (page) => {
              await reviewButton(page).click({
                timeout: workspaceE2ETimeouts.browserAction,
              });
              await page
                .getByRole("dialog")
                .getByRole("button", { name: "Create and send invoice" })
                .click({ timeout: workspaceE2ETimeouts.uiTransition });
            });
            const url = yield* waitForPageUrl({
              description: "issued invoice page",
              matches: (candidate) =>
                issuedInvoicePath.test(new URL(candidate).pathname),
              session,
              timeoutMs: workspaceE2ETimeouts.providerTransition,
            });
            const id = issuedInvoicePath.exec(new URL(url).pathname)?.[1];
            if (!id) {
              return yield* workspaceE2EError(
                "The issued invoice page names no invoice",
                { operation: "issue manual invoice" }
              );
            }
            addRedaction(id);
            yield* identities.recordRetainedInvoice(id);
            return id;
          }),
          id: "issue-manual-invoice",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        });
        const issued = yield* step({
          execute: readIssuedInvoice(invoiceId, customer),
          id: "read-issued-invoice",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        yield* step({
          execute: identities.signIn(customer, { origin, session }),
          id: "sign-in-linked-customer",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        yield* step({
          execute: session.use("download the invoice PDF", (page) =>
            withResponse(page, origin, pdfPath(issued.id), async (response) => {
              equal(response.status(), 200);
              expectPrivateAttachment(response, "application/pdf");
              const bytes = await response.body();
              equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
              const { text } = await extractPdfText(bytes);
              ok(
                text.includes(issued.invoiceNumber),
                "the PDF must show the invoice number"
              );
              ok(
                text.includes(`${linePrice} ${lineCurrency}`),
                "the PDF must show the exact total"
              );
            })
          ),
          id: "download-invoice-pdf",
          timeoutMs: workspaceE2ETimeouts.browserNavigation,
        });
        yield* step({
          execute: session.use("download the invoice export", (page) =>
            withResponse(page, origin, exportPath, async (response) => {
              equal(response.status(), 200);
              expectPrivateAttachment(response, "text/csv; charset=utf-8");
              const [header, ...rows] = parseCsv(
                (await response.body()).toString("utf8")
              );
              equal(header?.length, 6, "the export has six columns");
              deepEqual(rows.map(withExactTotal), [
                [
                  issued.invoiceNumber,
                  issued.issuedOn,
                  "",
                  exactAmount(linePrice),
                  lineCurrency,
                  getCustomerInvoiceStatusLabel("paid", locale),
                ],
              ]);
            })
          ),
          id: "download-invoice-export",
          timeoutMs: workspaceE2ETimeouts.browserNavigation,
        });
        yield* step({
          execute: session.use(
            "request both downloads signed out",
            async (page) => {
              await page.context().clearCookies({ name: /better-auth\./ });
              for (const path of [pdfPath(issued.id), exportPath]) {
                await withResponse(page, origin, path, async (response) => {
                  equal(response.status(), 404);
                  equal(
                    response.headers()["cache-control"],
                    "private, no-store"
                  );
                  equal((await response.body()).length, 0);
                });
              }
            }
          ),
          id: "refuse-signed-out-downloads",
          timeoutMs: workspaceE2ETimeouts.browserNavigation,
        });
      }),
    })
  );
});

const reviewButton = (page: Page) =>
  page.getByRole("button", { name: "Review invoice" });

/**
 * Searches the administration's customer lookup for the profile's exact
 * synthetic recipient and selects its one result. The lookup only reads, so
 * a search that doesn't list the new profile yet is repeated until the
 * step's deadline ends it.
 */
const selectCustomer = async (
  page: Page,
  customer: WorkspaceE2EAdministrationLinkedAccount
) => {
  const select = page.getByRole("button", { name: "Select", exact: true });
  await page
    .getByRole("searchbox", { name: "Name or email" })
    .fill(customer.email, { timeout: workspaceE2ETimeouts.browserAction });
  const deadline = Date.now() + workspaceE2ETimeouts.providerTransition;
  for (;;) {
    await page
      .getByRole("button", { name: "Search", exact: true })
      .click({ timeout: workspaceE2ETimeouts.browserAction });
    try {
      await select.first().waitFor({
        state: "visible",
        timeout: workspaceE2ETimeouts.browserAction,
      });
      break;
    } catch (error) {
      // Not listed yet: search again until the step's deadline.
      if (Date.now() >= deadline) throw error;
    }
  }
  equal(
    await select.count(),
    1,
    "the synthetic recipient matches one customer"
  );
  await select.click({ timeout: workspaceE2ETimeouts.browserAction });
  await expect(page.getByLabel("Invoice email")).toHaveValue(customer.email, {
    timeout: workspaceE2ETimeouts.browserAction,
  });
};

/** The issued invoice's row, which must belong to the case's customer. */
const readIssuedInvoice = Effect.fn("readIssuedInvoice")(function* (
  invoiceId: string,
  customer: WorkspaceE2EAdministrationLinkedAccount
) {
  const { db } = yield* E2EDatabase;
  const [row] = yield* runDatabaseOperation(
    "read issued invoice",
    db
      .select({
        dotyposCustomerId: invoices.dotyposCustomerId,
        invoiceNumber: invoices.invoiceNumber,
        issuedAt: invoices.issuedAt,
      })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
  );
  if (row?.dotyposCustomerId !== customer.customerId) {
    return yield* workspaceE2EError(
      "The issued invoice does not belong to the synthetic customer",
      { operation: "read issued invoice" }
    );
  }
  addRedaction(row.invoiceNumber);
  return {
    id: invoiceId,
    invoiceNumber: row.invoiceNumber,
    issuedOn: temporalInstantToPlainDate({
      instant: row.issuedAt,
      timeZone: workspaceSiteConstants.location.timeZone,
    }).toString(),
  } satisfies IssuedInvoice;
});

/** Requests `path` with the browser session's cookies and disposes the body. */
const withResponse = async (
  page: Page,
  origin: string,
  path: string,
  inspect: (response: APIResponse) => Promise<void>
) => {
  const response = await page.request.get(new URL(path, origin).toString(), {
    maxRedirects: 0,
    timeout: workspaceE2ETimeouts.browserNavigation,
  });
  try {
    await inspect(response);
  } finally {
    await response.dispose();
  }
};

const expectPrivateAttachment = (
  response: APIResponse,
  contentType: string
) => {
  const headers = response.headers();
  equal(headers["content-type"], contentType);
  match(headers["content-disposition"] ?? "", /^attachment; filename="/);
  equal(headers["cache-control"], "private, no-store");
};

/** A decimal amount in one canonical spelling, so `99.9` equals `99.90`. */
const exactAmount = (amount: string) =>
  BigDecimal.format(BigDecimal.normalize(BigDecimal.fromStringUnsafe(amount)));

/** An export row with its total amount (the fourth cell) made canonical. */
const withExactTotal = ([
  number,
  issuedOn,
  dueOn,
  total,
  ...rest
]: string[]) => [number, issuedOn, dueOn, exactAmount(total ?? ""), ...rest];
