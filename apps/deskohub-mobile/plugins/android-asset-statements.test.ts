import { describe, expect, test } from "bun:test";
import type { AndroidConfig, AndroidManifest } from "expo/config-plugins";
import withAndroidAssetStatements, {
  androidStringResourceText,
  assetStatements,
  setAssetStatementsMetaData,
  setAssetStatementsString,
} from "./android-asset-statements.cjs";

type ResourceXML = AndroidConfig.Resources.ResourceXML;

const site = "https://workspace.deskohub.cz";
const statement = (origin: string) => ({
  relation: ["delegate_permission/common.handle_all_urls"],
  target: { namespace: "web", site: origin },
});

// aapt2 turns `\n` and `\t` into a newline and a tab, and every other
// backslash escape into the character after it.
const controlEscapes: Readonly<Record<string, string>> = { n: "\n", t: "\t" };
const compiledText = (resourceText: string) =>
  resourceText.replace(
    /\\(.)/g,
    (_, character: string) => controlEscapes[character] ?? character
  );

const manifest = (
  metaData: NonNullable<
    AndroidManifest["manifest"]["application"]
  >[number]["meta-data"] = undefined
): AndroidManifest => ({
  manifest: {
    $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
    queries: [],
    application: [
      {
        $: { "android:name": ".MainApplication" },
        ...(metaData ? { "meta-data": metaData } : {}),
      },
    ],
  },
});

const metaData = (result: AndroidManifest) =>
  result.manifest.application?.[0]?.["meta-data"] ?? [];

const assetStatementStrings = (strings: ResourceXML) =>
  (strings.resources.string ?? []).filter(
    (item) => item.$.name === "asset_statements"
  );

describe("assetStatements", () => {
  test("lists a handle_all_urls statement per site", () => {
    expect(JSON.parse(assetStatements([site, "https://deskohub.cz"]))).toEqual([
      statement(site),
      statement("https://deskohub.cz"),
    ]);
  });

  test.each([
    [[]],
    [["http://workspace.deskohub.cz"]],
    [["https://workspace.deskohub.cz/"]],
    [["https://workspace.deskohub.cz/app"]],
    [["workspace.deskohub.cz"]],
    [[1]],
  ])("rejects %p", (sites) => {
    expect(() => assetStatements(sites as string[])).toThrow();
  });
});

describe("androidStringResourceText", () => {
  test.each([
    '{"a":"b"}',
    "it's",
    "back\\slash",
    "@string/name",
    "?attr",
    "two\nlines\tand tab",
  ])("compiles back to %p", (text) => {
    expect(compiledText(androidStringResourceText(text))).toBe(text);
  });

  test("leaves no bare double quote for aapt2 to drop", () => {
    expect(androidStringResourceText(assetStatements([site]))).not.toMatch(
      /(^|[^\\])"/
    );
  });
});

describe("setAssetStatementsString", () => {
  test("adds the statements string to empty strings.xml", () => {
    const [item, ...rest] = assetStatementStrings(
      setAssetStatementsString({ resources: {} }, [site])
    );
    expect(rest).toEqual([]);
    expect(item?.$.translatable).toBe("false");
    expect(JSON.parse(compiledText(item?._ ?? ""))).toEqual([statement(site)]);
  });

  test("keeps other strings and does not duplicate on a repeated run", () => {
    const strings: ResourceXML = {
      resources: { string: [{ $: { name: "app_name" }, _: "Deskohub" }] },
    };
    const once = setAssetStatementsString(structuredClone(strings), [site]);
    const twice = setAssetStatementsString(structuredClone(once), [site]);
    expect(twice).toEqual(once);
    expect(twice.resources.string?.map((item) => item.$.name)).toEqual([
      "app_name",
      "asset_statements",
    ]);
  });

  test("replaces an existing statements string", () => {
    const strings: ResourceXML = {
      resources: {
        string: [{ $: { name: "asset_statements" }, _: "[]" }],
      },
    };
    const [item, ...rest] = assetStatementStrings(
      setAssetStatementsString(strings, [site, "https://deskohub.cz"])
    );
    expect(rest).toEqual([]);
    expect(JSON.parse(compiledText(item?._ ?? ""))).toEqual([
      statement(site),
      statement("https://deskohub.cz"),
    ]);
  });
});

describe("setAssetStatementsMetaData", () => {
  const entry = {
    $: {
      "android:name": "asset_statements",
      "android:resource": "@string/asset_statements",
    },
  };

  test("adds the meta-data entry under <application>", () => {
    expect(metaData(setAssetStatementsMetaData(manifest()))).toEqual([entry]);
  });

  test("does not duplicate the entry on a repeated run", () => {
    const once = setAssetStatementsMetaData(manifest());
    const twice = setAssetStatementsMetaData(structuredClone(once));
    expect(twice).toEqual(once);
  });

  test("replaces an existing entry and keeps other meta-data", () => {
    const other = {
      $: {
        "android:name": "expo.modules.updates.ENABLED",
        "android:value": "false",
      },
    };
    const result = setAssetStatementsMetaData(
      manifest([
        other,
        { $: { "android:name": "asset_statements", "android:value": "[]" } },
        {
          $: {
            "android:name": "asset_statements",
            "android:resource": "@string/old",
          },
        },
      ])
    );
    expect(metaData(result)).toEqual([other, entry]);
  });
});

describe("withAndroidAssetStatements", () => {
  test("rejects missing sites", () => {
    expect(() =>
      withAndroidAssetStatements(
        { name: "Deskohub", slug: "deskohub" },
        {
          sites: [],
        }
      )
    ).toThrow();
  });
});
