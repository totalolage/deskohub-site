import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

describe("LocalizedNextComponent", () => {
  const runComponent = async (props: { params: Promise<object> }) => {
    setBoardgameTestEnv();
    const { getLocale } = await import("@/features/i18n");
    const { LocaleValue } = await import("./locale-value");
    const { LocalizedNextComponent } = await import(
      "./localized-next-component"
    );

    // Renders the provided locale beside the one Paraglide messages read.
    return LocalizedNextComponent.build(() =>
      Effect.map(LocaleValue, (locale) => [locale, getLocale()])
    )(props);
  };

  test("valid en-US params supplies LocaleValue and the message locale", async () => {
    await expect(
      runComponent({ params: Promise.resolve({ locale: "en-US" }) })
    ).resolves.toEqual(["en-US", "en-US"]);
  });

  test("a rendered locale does not outlive its request", async () => {
    const { getLocale } = await import("@/features/i18n");

    await runComponent({ params: Promise.resolve({ locale: "en-US" }) });

    expect(getLocale()).toBe("cs-CZ");
  });
});
