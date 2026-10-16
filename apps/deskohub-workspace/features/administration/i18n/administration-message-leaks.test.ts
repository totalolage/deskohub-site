import { describe, expect, test } from "bun:test";
import {
  classifyChunks,
  findTexts,
  readCatalogTexts,
  selectLeakEvidence,
} from "./administration-message-leaks.test-utils";

const administrationTexts = selectLeakEvidence(
  readCatalogTexts(
    "cs-CZ",
    JSON.stringify({
      plain: "Smazat koncept kampaně",
      parameterized: "Zobrazeno {count} záznamů auditu pro správce {operator}",
      matched: [
        {
          match: {
            "count=one": "{count} rezervace čeká na vrácení peněz",
            "count=*": "{count} rezervací čeká na vrácení peněz",
          },
        },
      ],
      short: "Kódy",
      shared: "Zkusit znovu",
    })
  ),
  readCatalogTexts(
    "cs-CZ",
    JSON.stringify({ retry: "Zkusit znovu", total: "Celkem {count} položek" })
  )
);

const texts = (source: string) =>
  findTexts(administrationTexts, source).map(({ text }) => text);

describe("administration message leak evidence", () => {
  test("keeps distinctive plain texts and the static runs of parameterized ones", () => {
    expect(administrationTexts).toEqual([
      { locale: "cs-CZ", text: "Smazat koncept kampaně", fragment: false },
      { locale: "cs-CZ", text: " záznamů auditu pro správce ", fragment: true },
      {
        locale: "cs-CZ",
        text: " rezervace čeká na vrácení peněz",
        fragment: true,
      },
      {
        locale: "cs-CZ",
        text: " rezervací čeká na vrácení peněz",
        fragment: true,
      },
    ]);
  });

  test("finds a parameterized message compiled to a template literal", () => {
    expect(
      texts(
        "return`Zobrazeno ${e?.count} z\\xe1znam\\u016F auditu pro spr\\xe1vce ${e?.operator}`"
      )
    ).toEqual([" záznamů auditu pro správce "]);
  });

  test("finds a parameterized message compiled to concatenation", () => {
    expect(
      texts(
        'return e.count+" rezervac\\xed \\u010Dek\\xe1 na vr\\xe1cen\\xed pen\\u011Bz"'
      )
    ).toEqual([" rezervací čeká na vrácení peněz"]);
  });

  test("finds a plain message only as a whole string literal", () => {
    expect(texts('const t="Smazat koncept kampan\\u011B"')).toEqual([
      "Smazat koncept kampaně",
    ]);
    expect(texts('const t="Smazat koncept kampaně a vše"')).toEqual([]);
  });
});

describe("client chunk attribution", () => {
  const classify = (
    chunks: Record<string, string>,
    entries: {
      readonly administration?: readonly string[];
      readonly customer?: readonly string[];
    }
  ) => {
    const { administrationOnly } = classifyChunks({
      administrationEntryChunks: new Set(entries.administration),
      chunks: new Map(Object.entries(chunks)),
      customerEntryChunks: new Set(entries.customer),
    });
    return [...administrationOnly].sort();
  };

  test("attributes chunks only administration routes load, directly or lazily", () => {
    expect(
      classify(
        {
          "static/chunks/admin.js": 'e.l("static/chunks/admin-lazy.js")',
          "static/chunks/admin-lazy.js": "",
          "static/chunks/site.js": "",
        },
        {
          administration: ["static/chunks/admin.js"],
          customer: ["static/chunks/site.js"],
        }
      )
    ).toEqual(["static/chunks/admin-lazy.js", "static/chunks/admin.js"]);
  });

  test("counts a chunk any customer chunk can load as customer-reachable", () => {
    expect(
      classify(
        {
          "static/chunks/admin.js": 'e.l("static/chunks/shared-lazy.js")',
          "static/chunks/shared-lazy.js": "",
          "static/chunks/site.js": 'e.l("static/chunks/site-lazy.js")',
          "static/chunks/site-lazy.js":
            'e.l("static/chunks/shared-lazy.js","static/chunks/admin.js")',
        },
        {
          administration: ["static/chunks/admin.js"],
          customer: ["static/chunks/site.js"],
        }
      )
    ).toEqual([]);
  });

  test("counts a chunk nothing accounts for as customer-reachable", () => {
    expect(
      classify(
        {
          "static/chunks/admin.js": "",
          "static/chunks/orphan.js": 'e.l("static/chunks/orphan-lazy.js")',
          "static/chunks/orphan-lazy.js": "",
        },
        { administration: ["static/chunks/admin.js"] }
      )
    ).toEqual(["static/chunks/admin.js"]);
  });

  test("counts a chunk both route kinds list as customer-reachable", () => {
    expect(
      classify(
        { "static/chunks/shared.js": "" },
        {
          administration: ["static/chunks/shared.js"],
          customer: ["static/chunks/shared.js"],
        }
      )
    ).toEqual([]);
  });
});
