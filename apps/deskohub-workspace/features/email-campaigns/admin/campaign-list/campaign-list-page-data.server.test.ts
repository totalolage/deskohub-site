import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { stubCampaignPageQueries } from "../campaign-operation-query.test-utils";

const port = stubCampaignPageQueries();

const { loadCampaignList, loadCampaignListDelivery } = await import(
  "./campaign-list-page-data.server"
);

const summary = (
  id: string,
  fields: {
    readonly delivery: string;
    readonly status: string;
    readonly audienceId?: string | null;
  }
) => ({
  id,
  title: `Campaign ${id}`,
  purpose: "marketing",
  audienceId: null,
  updatedAt: "2026-10-05T08:00:00.000Z",
  ...fields,
});

const onceDraft = summary("once-draft", {
  delivery: "once",
  status: "draft",
  audienceId: "regulars",
});
const automatedActive = summary("automated-active", {
  delivery: "automated",
  status: "active",
  audienceId: "deleted-audience",
});

beforeEach(() => {
  port.access.set("administrator");
  port.invoked.length = 0;
  port.responses = {
    listCampaigns: Effect.succeed([onceDraft, automatedActive]),
    listCampaignAudiences: Effect.succeed([
      { id: "regulars", title: "Regulars" },
    ]),
  };
});

describe("loadCampaignListDelivery", () => {
  test("reads a known delivery from the URL and ignores anything else", async () => {
    const deliveryOf = (delivery: string | string[] | undefined) =>
      loadCampaignListDelivery(Promise.resolve({ delivery }));

    expect(await deliveryOf("once")).toBe("once");
    expect(await deliveryOf("automated")).toBe("automated");
    expect(await deliveryOf("weekly")).toBeUndefined();
    expect(await deliveryOf(["once"])).toBeUndefined();
    expect(await deliveryOf(undefined)).toBeUndefined();
  });
});

describe("loadCampaignList", () => {
  test("lists every campaign with its delivery, status, and audience title", async () => {
    expect(await loadCampaignList(Promise.resolve(undefined))).toEqual([
      {
        id: "once-draft",
        title: "Campaign once-draft",
        purpose: "marketing",
        audienceTitle: "Regulars",
        updatedAt: "2026-10-05T08:00:00.000Z",
        delivery: "once",
        status: "draft",
      },
      {
        id: "automated-active",
        title: "Campaign automated-active",
        purpose: "marketing",
        audienceTitle: null,
        updatedAt: "2026-10-05T08:00:00.000Z",
        delivery: "automated",
        status: "active",
      },
    ]);
  });

  test("keeps only the campaigns of the shown delivery", async () => {
    const idsOf = async (delivery: "once" | "automated") =>
      (await loadCampaignList(Promise.resolve(delivery))).map(({ id }) => id);

    expect(await idsOf("once")).toEqual(["once-draft"]);
    expect(await idsOf("automated")).toEqual(["automated-active"]);
  });

  test("a campaign without an audience lists with no audience title", async () => {
    port.responses.listCampaigns = Effect.succeed([
      summary("no-audience", { delivery: "once", status: "sent" }),
    ]);

    expect(await loadCampaignList(Promise.resolve(undefined))).toMatchObject([
      { id: "no-audience", audienceTitle: null, status: "sent" },
    ]);
  });

  test("drops a campaign whose status doesn't belong to its delivery", async () => {
    port.responses.listCampaigns = Effect.succeed([
      summary("once-active", { delivery: "once", status: "active" }),
      summary("automated-sent", { delivery: "automated", status: "sent" }),
      onceDraft,
    ]);

    expect(
      (await loadCampaignList(Promise.resolve(undefined))).map(({ id }) => id)
    ).toEqual(["once-draft"]);
  });

  test("reads the campaigns and audiences from the campaign port", async () => {
    await loadCampaignList(Promise.resolve(undefined));

    expect(port.invoked.map(({ name }) => name).sort()).toEqual([
      "listCampaignAudiences",
      "listCampaigns",
    ]);
  });
});
