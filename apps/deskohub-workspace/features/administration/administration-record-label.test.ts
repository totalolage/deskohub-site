import { describe, expect, test } from "bun:test";
import type { AdministrationRecordArea } from "./administration-areas";
import {
  type AdministrationRecordLabelLoader,
  loadAdministrationRecordLabel,
} from "./administration-record-label";

const recordingLoader = (label: string | null | undefined) => {
  const calls: (readonly [string, string])[] = [];
  const load: AdministrationRecordLabelLoader = async (recordId, locale) => {
    calls.push([recordId, locale]);
    return label;
  };
  return { calls, load };
};

const loadersFor = (
  entries: readonly (readonly [
    AdministrationRecordArea,
    AdministrationRecordLabelLoader,
  ])[]
) => new Map(entries);

describe("loadAdministrationRecordLabel", () => {
  test("loads the label of the record the path names, in the route locale", async () => {
    const invoices = recordingLoader("2026-0042");
    const customers = recordingLoader("Bea Booked");

    const label = await loadAdministrationRecordLabel({
      loaders: loadersFor([
        ["invoices", invoices.load],
        ["customers", customers.load],
      ]),
      locale: "cs-CZ",
      segments: ["invoices", "invoice-1"],
    });

    expect(label).toBe("2026-0042");
    expect(invoices.calls).toEqual([["invoice-1", "cs-CZ"]]);
    expect(customers.calls).toEqual([]);
  });

  test("finds the record under a page inside it", async () => {
    const campaigns = recordingLoader("Autumn newsletter");

    const label = await loadAdministrationRecordLabel({
      loaders: loadersFor([["email-campaigns", campaigns.load]]),
      locale: "en-US",
      segments: ["email-campaigns", "campaign-1", "runs", "run-1"],
    });

    expect(label).toBe("Autumn newsletter");
    expect(campaigns.calls).toEqual([["campaign-1", "en-US"]]);
  });

  test.each([null, undefined])(
    "keeps the area's record label when the loader finds none (%p)",
    async (found) => {
      const invoices = recordingLoader(found);

      await expect(
        loadAdministrationRecordLabel({
          loaders: loadersFor([["invoices", invoices.load]]),
          locale: "en-US",
          segments: ["invoices", "invoice-1"],
        })
      ).resolves.toBeUndefined();
      expect(invoices.calls).toHaveLength(1);
    }
  );

  test("loads nothing for a path without a record or an area without a loader", async () => {
    const invoices = recordingLoader("2026-0042");
    const loaders = loadersFor([["invoices", invoices.load]]);

    for (const segments of [[], ["invoices"], ["invoices", "new"]]) {
      await expect(
        loadAdministrationRecordLabel({ loaders, locale: "en-US", segments })
      ).resolves.toBeUndefined();
    }
    await expect(
      loadAdministrationRecordLabel({
        loaders,
        locale: "en-US",
        segments: ["customers", "customer-1"],
      })
    ).resolves.toBeUndefined();
    expect(invoices.calls).toEqual([]);
  });
});
