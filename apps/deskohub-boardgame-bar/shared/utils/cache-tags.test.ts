import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const appliedTags: string[][] = [];

let cacheTags: typeof import("./cache-tags");

beforeAll(async () => {
  const nextCache = await import("next/cache");
  mock.module("next/cache", () => ({
    ...nextCache,
    cacheTag: (...tags: string[]) => {
      appliedTags.push(tags);
    },
  }));
  cacheTags = await import("./cache-tags");
});

beforeEach(() => {
  appliedTags.length = 0;
});

describe("applyCacheTags", () => {
  test("applies a single tag", () => {
    cacheTags.applyCacheTags("menu:all");

    expect(appliedTags).toEqual([["menu:all"]]);
  });

  test("applies each of several tags in order", () => {
    cacheTags.applyCacheTags("menu:all", "games:catalog");

    expect(appliedTags).toEqual([["menu:all"], ["games:catalog"]]);
  });

  test("applies nothing without tags", () => {
    cacheTags.applyCacheTags();

    expect(appliedTags).toEqual([]);
  });
});

describe("dotyposTags.menu.getTags", () => {
  test("tags every menu read with the whole menu", () => {
    expect(cacheTags.dotyposTags.menu.getTags()).toEqual(["menu:all"]);
    expect(cacheTags.dotyposTags.menu.getTags({})).toEqual(["menu:all"]);
  });

  test("adds the category, product, and deleted-items tags it is given", () => {
    expect(
      cacheTags.dotyposTags.menu.getTags({
        categoryId: "c1",
        productId: "p1",
        includeDeleted: false,
      })
    ).toEqual([
      "menu:all",
      "menu:cat:c1",
      "menu:prod:p1",
      "menu:deleted:false",
    ]);
  });

  test("skips empty ids and keeps an included-deleted flag", () => {
    expect(
      cacheTags.dotyposTags.menu.getTags({
        categoryId: "",
        productId: "",
        includeDeleted: true,
      })
    ).toEqual(["menu:all", "menu:deleted:true"]);
  });
});

describe("domain tags", () => {
  test("namespaces opening-hours exceptions and the games catalog", () => {
    expect(cacheTags.openingHoursTags.exceptions()).toBe(
      "opening-hours:exceptions"
    );
    expect(cacheTags.gamesTags.catalog()).toBe("games:catalog");
  });
});
