import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

describe("LocalizedNextComponent", () => {
  const runComponent = async (props: { params: Promise<object> }) => {
    setBoardgameTestEnv();
    const { LocaleValue } = await import("./locale-value");
    const { LocalizedNextComponent } = await import(
      "./localized-next-component"
    );

    return LocalizedNextComponent.build(() =>
      Effect.gen(function* () {
        return yield* LocaleValue;
      })
    )(props);
  };

  test("valid en-US params supplies LocaleValue and sets locale", async () => {
    const { getLocale } = await import("@/features/i18n");

    const locale = await runComponent({
      params: Promise.resolve({ locale: "en-US" }),
    });

    expect(locale).toBe("en-US");
    expect(getLocale()).toBe("en-US");
  });

  test("malformed props fails visibly", async () => {
    await expect(runComponent({ params: Promise.resolve({}) })).rejects.toThrow(
      "Failed to parse middleware props"
    );
  });
});
