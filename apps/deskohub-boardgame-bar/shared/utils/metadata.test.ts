import { beforeAll, describe, expect, mock, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ResolvingMetadata } from "next";
import type { RouteProps_locale } from "@/app/[locale]/route";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { PATHNAME_HEADER } from "@/shared/utils/constants";

const requestHeaders = new AsyncLocalStorage<Headers>();

let metadata: typeof import("./metadata").metadata;

beforeAll(async () => {
  setBoardgameTestEnv();
  const nextHeaders = await import("next/headers");
  mock.module("next/headers", () => ({
    ...nextHeaders,
    headers: async () => requestHeaders.getStore() ?? new Headers(),
  }));
  ({ metadata } = await import("./metadata"));
});

/** Generates page metadata for a cs-CZ request to `path`, if any. */
const generateFor = (
  page: Parameters<typeof metadata>[0],
  path: string | undefined
) => {
  const headers = new Headers();
  if (path) headers.set(PATHNAME_HEADER, path);
  const props = {
    params: Promise.resolve({ locale: "cs-CZ" }),
  } as unknown as RouteProps_locale;
  return requestHeaders.run(headers, () =>
    metadata(page)(props, {} as ResolvingMetadata)
  );
};

describe("metadata", () => {
  test("titles and describes the page and links its localized paths", async () => {
    const path = "/cs-CZ/contact";

    expect(
      await generateFor({ title: "Contact", description: "Find us" }, path)
    ).toEqual({
      title: { default: "Contact", template: "%s | Contact" },
      description: "Find us",
      alternates: {
        canonical: path,
        languages: { "cs-CZ": "/cs-CZ/contact", "en-US": "/en-US/contact" },
      },
    });
  });

  test("resolves lazy title and description on each generation", async () => {
    let generation = 0;
    const page = {
      title: () => `Menu ${++generation}`,
      description: () => `Dishes ${generation}`,
    };

    const first = await generateFor(page, undefined);
    const second = await generateFor(page, undefined);

    expect(first.title).toEqual({ default: "Menu 1", template: "%s | Menu 1" });
    expect(first.description).toBe("Dishes 1");
    expect(second.title).toEqual({
      default: "Menu 2",
      template: "%s | Menu 2",
    });
  });

  test("omits alternates when the request has no pathname", async () => {
    const generated = await generateFor(
      { title: "Home", description: "Welcome" },
      undefined
    );

    expect(generated.alternates).toBeUndefined();
  });
});
