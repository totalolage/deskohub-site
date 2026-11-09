import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import {
  administrationAreas,
  findAdministrationRecord,
  getAdministrationTrail,
} from "./administration-areas";
import { administrationHref } from "./administration-href";
import { m } from "./i18n";

type DeclaredSegment = {
  readonly href?: string;
  readonly pages?: Readonly<Record<string, DeclaredSegment>>;
  readonly record?: DeclaredSegment;
};

const overview: DeclaredSegment = { pages: administrationAreas };

const breadcrumbSlot = join(
  import.meta.dir,
  "../../app/[locale]/admin/@breadcrumb"
);

// Each breadcrumb slot page's path under `/admin`, as its route segments.
const slotRoutes = readdirSync(breadcrumbSlot, { recursive: true })
  .map(String)
  .filter((file) => file === "page.tsx" || file.endsWith(`${sep}page.tsx`))
  .map((file) =>
    dirname(file)
      .split(sep)
      .filter((segment) => segment !== ".")
  );

test("declares every page that has a breadcrumb slot", () => {
  expect(slotRoutes.length).toBeGreaterThan(30);
  for (const route of slotRoutes) {
    // A `[param]` segment is the parent's record; any other is a named page.
    const declared = route.reduce<DeclaredSegment | undefined>(
      (parent, segment) =>
        segment.startsWith("[") ? parent?.record : parent?.pages?.[segment],
      overview
    );
    expect({ route, declared: declared !== undefined }).toEqual({
      route,
      declared: true,
    });
  }
});

describe("getAdministrationTrail", () => {
  test("links each crumb to its page, encoding record IDs", () => {
    const campaignId = "campaign 1/2";
    const runId = "run-1";
    expect(
      getAdministrationTrail(
        ["email-campaigns", campaignId, "runs", runId],
        "en-US"
      ).map((crumb) => crumb.href)
    ).toEqual([
      administrationHref("/[locale]/admin"),
      administrationHref("/[locale]/admin/email-campaigns"),
      administrationHref("/[locale]/admin/email-campaigns/[campaignId]", {
        campaignId,
      }),
      administrationHref("/[locale]/admin/email-campaigns/[campaignId]/runs", {
        campaignId,
      }),
      administrationHref(
        "/[locale]/admin/email-campaigns/[campaignId]/runs/[runId]",
        { campaignId, runId }
      ),
    ]);
  });

  test("names the area's record with its loaded label", () => {
    const locale = "cs-CZ";
    const segments = ["email-campaigns", "campaign-1", "runs", "run-1"];
    const labels = (recordLabel?: string) =>
      getAdministrationTrail(segments, locale, recordLabel).map(
        (crumb) => crumb.label
      );

    expect(labels("Loaded campaign")).toEqual([
      m.shellBreadcrumbOverview({}, { locale }),
      m.shellBreadcrumbCampaigns({}, { locale }),
      "Loaded campaign",
      m.shellBreadcrumbCampaignRuns({}, { locale }),
      m.shellBreadcrumbCampaignRun({}, { locale }),
    ]);
    expect(labels()[2]).toBe(m.shellBreadcrumbCampaign({}, { locale }));
  });

  test("labels a named page under a collection, not its record", () => {
    const locale = "en-US";
    expect(
      getAdministrationTrail(["invoices", "new"], locale, "Loaded").map(
        (crumb) => crumb.label
      )
    ).toEqual([
      m.shellBreadcrumbOverview({}, { locale }),
      m.shellBreadcrumbInvoices({}, { locale }),
      m.shellBreadcrumbNewInvoice({}, { locale }),
    ]);
  });
});

describe("findAdministrationRecord", () => {
  test("finds the record the path's second segment names", () => {
    expect(findAdministrationRecord(["invoices", "invoice-1"])).toEqual({
      area: "invoices",
      recordId: "invoice-1",
    });
    expect(
      findAdministrationRecord(["customers", "customer-1", "create-code"])
    ).toEqual({ area: "customers", recordId: "customer-1" });
    expect(
      findAdministrationRecord(["email-campaigns", "campaign-1", "runs", "r-1"])
    ).toEqual({ area: "email-campaigns", recordId: "campaign-1" });
  });

  test("finds no record on a named page or an area without records", () => {
    for (const segments of [
      [],
      ["invoices"],
      ["invoices", "new"],
      ["email-campaigns", "new"],
      ["cli", "sessions"],
      ["sales", "sale-1"],
      ["unknown", "record-1"],
    ]) {
      expect(findAdministrationRecord(segments)).toBeUndefined();
    }
  });
});

// Each page outside a record, with the path that leads to it.
const pagesOutsideRecords = (
  parent: DeclaredSegment,
  path = "/admin"
): [string, DeclaredSegment][] =>
  Object.entries(parent.pages ?? {}).flatMap(([segment, page]) => [
    [`${path}/${segment}`, page],
    ...pagesOutsideRecords(page, `${path}/${segment}`),
  ]);

test("declares the href of each page outside a record", () => {
  for (const [path, page] of pagesOutsideRecords(overview)) {
    // `cli` groups the CLI pages and has no page of its own.
    expect({ path, href: page.href }).toEqual({
      path,
      href: path === "/admin/cli" ? undefined : path,
    });
  }
});
