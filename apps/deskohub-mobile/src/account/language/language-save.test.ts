import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import {
  languageSaveFailureMessage,
  languageSaveState,
  saveLanguageAtom,
} from "./language-save";

const choose = async (
  data: ReturnType<typeof makeFakeCustomerData>,
  locale: AppLocale
) => {
  const shown: Array<{ locale: AppLocale; sessionChecks: number }> = [];
  const { registry, device } = data;
  registry.mount(saveLanguageAtom);
  registry.set(saveLanguageAtom, {
    locale,
    show: (chosen) =>
      shown.push({ locale: chosen, sessionChecks: device.sessionChecks }),
  });
  expect(languageSaveState(registry.get(saveLanguageAtom)).status).toBe(
    "saving"
  );
  await Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(saveLanguageAtom, { suspendOnWaiting: true })(
        registry
      )
    )
  );
  return { shown, state: languageSaveState(registry.get(saveLanguageAtom)) };
};

describe("saveLanguageAtom", () => {
  test("saves the locale, shows it, then asks for the session again", async () => {
    const data = makeFakeCustomerData("linked");
    const { shown, state } = await choose(data, "uk-UA");
    expect(data.workspace.calls).toContain("updateLocale");
    expect(shown).toEqual([{ locale: "uk-UA", sessionChecks: 0 }]);
    expect(data.device.sessionChecks).toBe(1);
    expect(state).toEqual({ status: "idle" });
  });

  test("reads the account again, whose language the profile forms read a phone in", async () => {
    const data = makeFakeCustomerData("linked");
    await settle(data.registry, accountAtom);
    await choose(data, "de-DE");
    expect(await settle(data.registry, accountAtom)).toMatchObject({
      success: { locale: "de-DE" },
    });
  });

  test("saves for an account without a profile", async () => {
    const data = makeFakeCustomerData("completion-required");
    const { shown } = await choose(data, "de-DE");
    expect(shown.map(({ locale }) => locale)).toEqual(["de-DE"]);
  });

  test("keeps the old locale when the save is refused", async () => {
    const data = makeFakeCustomerData("linked");
    data.workspace.fail("updateLocale", "service-unavailable");
    const { shown, state } = await choose(data, "sk-SK");
    expect(shown).toEqual([]);
    expect(data.device.sessionChecks).toBe(0);
    expect(state).toEqual({
      status: "failed",
      error: CustomerViewError.Unavailable(),
    });
  });

  test("keeps the old locale but reads the session again when the save may have applied", async () => {
    const data = makeFakeCustomerData("linked");
    data.workspace.fail("updateLocale", "transport-failure");
    const { shown, state } = await choose(data, "sk-SK");
    expect(shown).toEqual([]);
    expect(data.device.sessionChecks).toBe(1);
    expect(state).toEqual({
      status: "failed",
      error: CustomerViewError.Unconfirmed(),
    });
  });
});

describe("languageSaveFailureMessage", () => {
  test("names the language for a failure without a shared sentence", () => {
    const failures: ReadonlyArray<CustomerViewError> = [
      CustomerViewError.Unexpected(),
      CustomerViewError.NotFound(),
    ];
    for (const error of failures) {
      expect(languageSaveFailureMessage(error, "en-US")).toBe(
        m.account_language_save_failed({}, { locale: "en-US" })
      );
    }
  });

  test("uses the shared sentence for a failure every screen words alike", () => {
    expect(
      languageSaveFailureMessage(CustomerViewError.RateLimited(), "en-US")
    ).toBe(m.account_error_rate_limited({}, { locale: "en-US" }));
  });
});
