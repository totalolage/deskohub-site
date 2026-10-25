import { describe, expect, mock, test } from "bun:test";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { Temporal as PolyfillTemporal } from "@js-temporal/polyfill";
import { commandOutput } from "@/scripts/shared/command";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { buildTemporalPolyfill } from "./build-temporal-polyfill";
import { isTemporalComplete, requiredTemporalApis } from "./temporal-runtime";

const appRoot = resolve(import.meta.dir, "../..");
const { timeZone } = workspaceSiteConstants.location;

type TemporalNamespace = keyof typeof requiredTemporalApis;
/** A Temporal global as a browser may ship it: missing, partial, or whole. */
type TemporalCandidate =
  | {
      readonly [Namespace in TemporalNamespace]?: Partial<
        (typeof PolyfillTemporal)[Namespace]
      >;
    }
  | undefined;

const isComplete = (temporal: TemporalCandidate) =>
  isTemporalComplete(temporal, requiredTemporalApis, timeZone);

/** The polyfill with one namespace replaced. */
const withNamespace = <Namespace extends TemporalNamespace>(
  namespace: Namespace,
  replacement: Partial<(typeof PolyfillTemporal)[Namespace]>
): TemporalCandidate => ({
  ...Object.fromEntries(
    Object.keys(requiredTemporalApis).map((key) => [
      key,
      PolyfillTemporal[key as TemporalNamespace],
    ])
  ),
  [namespace]: replacement,
});

describe("isTemporalComplete", () => {
  test("accepts a complete Temporal", () => {
    expect(isComplete(PolyfillTemporal)).toBe(true);
  });

  test.each([
    ["no Temporal", undefined],
    ["an empty Temporal", {}],
    ["a Temporal without one entry point", withNamespace("PlainYearMonth", {})],
    [
      "a Temporal whose dates lack arithmetic",
      withNamespace("PlainDate", {
        compare: PolyfillTemporal.PlainDate.compare,
        from: (item: string) =>
          Object.assign(PolyfillTemporal.PlainDate.from(item), {
            add: undefined,
          }),
      }),
    ],
  ])("rejects %s", (_case, temporal) => {
    expect(isComplete(temporal)).toBe(false);
  });

  test("rejects a Temporal without the site's time zone data", () => {
    expect(
      isTemporalComplete(PolyfillTemporal, requiredTemporalApis, "Mars/Base")
    ).toBe(false);
  });

  test("lists every Temporal entry point Workspace code calls", async () => {
    const listing = await commandOutput(
      ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: appRoot }
    );
    const paths = listing
      .split("\0")
      .filter(
        (path) =>
          /(?<!\.d)\.(?:ts|tsx)$/.test(path) &&
          !/\.test\.tsx?$/.test(path) &&
          !/^(?:e2e|scripts)\//.test(path)
      );

    const unlisted = new Set<string>();
    for (const path of paths) {
      const sourceText = await Bun.file(resolve(appRoot, path)).text();
      for (const [, namespace = "", member = ""] of sourceText.matchAll(
        /\bTemporal\.([A-Z]\w*)\.([a-z]\w*)\b/g
      )) {
        const members: readonly string[] =
          requiredTemporalApis[
            namespace as keyof typeof requiredTemporalApis
          ] ?? [];
        if (!members.includes(member)) unlisted.add(`${namespace}.${member}`);
      }
    }

    expect(paths.length).toBeGreaterThan(0);
    expect([...unlisted]).toEqual([]);
  });
});

const { polyfill, loader } = await buildTemporalPolyfill();

/** A browser-like global with the given Temporal, or none. */
const browserContext = (temporal?: TemporalCandidate) => {
  const write = mock((_html: string) => {});
  const context = createContext({ document: { write } });
  runInContext("delete globalThis.Temporal", context);
  if (temporal !== undefined) context.Temporal = temporal;
  return { context, write };
};

describe("temporal-polyfill:build", () => {
  test("the loader can't end its inline script element early", () => {
    expect(loader).not.toMatch(/<\/script/i);
  });

  test("the loader requests nothing where Temporal is complete", () => {
    const { context, write } = browserContext(PolyfillTemporal);

    runInContext(loader, context);

    expect(write).not.toHaveBeenCalled();
  });

  test.each([
    ["missing", undefined],
    ["incomplete", withNamespace("PlainYearMonth", {})],
  ])(
    "the loader inserts the polyfill where Temporal is %s",
    (_case, temporal) => {
      const { context, write } = browserContext(temporal);

      runInContext(loader, context);

      expect(write).toHaveBeenCalledTimes(1);
      expect(write.mock.calls[0]?.[0]).toMatch(
        /^<script src="\/polyfills\/temporal\.js\?v=\w+"><\/script>$/
      );
    }
  );

  test.each([
    ["missing", undefined],
    ["incomplete", withNamespace("PlainYearMonth", {})],
  ])(
    "the polyfill installs a complete Temporal where it is %s",
    (_case, temporal) => {
      const { context } = browserContext(temporal);

      runInContext(polyfill, context);

      expect(isComplete(context.Temporal)).toBe(true);
    }
  );
});
