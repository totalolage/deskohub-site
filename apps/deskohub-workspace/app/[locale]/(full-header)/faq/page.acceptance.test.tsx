import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Locale } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const syntheticOccupancy = {
  averageReservationsPerDay: 2.36,
  coworkSeatCapacity: 17,
} as const;
const loadFaqOccupancyStats = mock(async () => syntheticOccupancy);
let requestLocale: Locale = "en-US";

function runWithRequestLocale<A>(resolve: (locale: Locale) => A) {
  return Promise.resolve(resolve(requestLocale));
}

mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale,
}));
mock.module("@/features/faq/backend/faq-occupancy.server", () => ({
  loadFaqOccupancyStats,
}));

const { default: LocalizedFaqPage } = await import("./page");

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
  loadFaqOccupancyStats.mockClear();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

test("the localized FAQ route renders six closed disclosures and every English answer", async () => {
  requestLocale = "en-US";
  const view = render(await LocalizedFaqPage());

  expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(
    view.getByRole("heading", {
      level: 1,
      name: "Frequenty Asked Questions",
    })
  ).toBeTruthy();
  const disclosures = view.container.querySelectorAll("details");
  expect(disclosures).toHaveLength(6);
  for (const disclosure of disclosures) {
    expect(disclosure.open).toBe(false);
    expect(disclosure.hasAttribute("open")).toBe(false);
    const summary = disclosure.querySelector("summary");
    const question = summary?.querySelector("h2")?.textContent?.trim();
    if (!summary || !question) {
      throw new Error("FAQ disclosure is missing its native summary question.");
    }
    expect(summary.tagName).toBe("SUMMARY");
  }
  expect(loadFaqOccupancyStats).toHaveBeenCalledTimes(1);

  for (const disclosure of disclosures) {
    fireEvent.click(disclosure.querySelector("summary")!);
    expect(disclosure.open).toBe(true);
  }

  expect(
    view.getByText("Turnovská 430/10, Libeň, Praha 8 180 00")
  ).toBeTruthy();
  expect(view.container.querySelector("address")?.textContent).toBe(
    "Turnovská 430/10, Libeň, Praha 8 180 00"
  );
  expect(
    view.getByText(
      "Book online through the reservation form, you will receive an access code to your email. Use this code on the keypad at the front door to come and go as you like!"
    )
  ).toBeTruthy();
  expect(
    view.getByText("We have Optical Fiber internet and 6G WiFi available.")
  ).toBeTruthy();
  expect(
    view.getByText(
      "Yes, you are welcome to bring food, as well as purchase drinks from our drinks fridge. We even have plates, cutlery, and a small oven for reheating your food!"
    )
  ).toBeTruthy();
  expect(
    view.getByText(
      "At the moment we do not have dedicated booths. However we do have a bookable meeting room, if you need a while away from other patrons."
    )
  ).toBeTruthy();
  expect(
    view.getByText(
      "At the moment we average 2.4 patrons a day, with a capacity for up to 17"
    )
  ).toBeTruthy();
});

test("the localized FAQ route uses Czech catalog copy and number formatting", async () => {
  requestLocale = "cs-CZ";
  const view = render(await LocalizedFaqPage());

  expect(
    view.getByRole("heading", { level: 1, name: "Často kladené otázky" })
  ).toBeTruthy();
  const summaries = Array.from(view.container.querySelectorAll("summary"));
  expect(
    summaries.map((summary) => summary.querySelector("h2")?.textContent)
  ).toEqual([
    "Kde se nacházíte?",
    "Jak to funguje?",
    "Je tu kvalitní internetové připojení?",
    "Mohu si do coworku přinést jídlo?",
    "Je tu prostor pro telefonování?",
    "Jak bývá v coworku plno?",
  ]);
  for (const summary of summaries) fireEvent.click(summary);
  expect(
    view.getByText("Turnovská 430/10, Libeň, Praha 8 180 00")
  ).toBeTruthy();
  expect(
    view.getByText(
      "Zarezervuj si místo online přes rezervační formulář a přístupový kód ti přijde e-mailem. Zadej ho na klávesnici u hlavních dveří a můžeš podle potřeby přicházet i odcházet!"
    )
  ).toBeTruthy();
  expect(
    view.getByText("K dispozici máme optický internet a Wi-Fi 6G.")
  ).toBeTruthy();
  expect(
    view.getByText(
      "Ano, jídlo si můžeš přinést a můžeš si také koupit nápoje z naší lednice. Máme dokonce talíře, příbory a malou troubu na ohřátí jídla!"
    )
  ).toBeTruthy();
  expect(
    view.getByText(
      "V tuto chvíli nemáme vyhrazené telefonní budky. Můžeš si ale rezervovat zasedací místnost, pokud potřebuješ chvíli mimo ostatní návštěvníky."
    )
  ).toBeTruthy();
  expect(
    view.getByText(
      "V tuto chvíli máme v průměru 2,4 návštěvníků denně a kapacitu až 17."
    )
  ).toBeTruthy();
  expect(loadFaqOccupancyStats).toHaveBeenCalledTimes(1);
});
