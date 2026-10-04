import { expect, mock, test } from "bun:test";
import type { Locale } from "@/features/i18n";

let requestLocale: Locale = "en-US";

mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (resolve: (locale: Locale) => unknown) =>
    Promise.resolve(resolve(requestLocale)),
}));
mock.module("@/features/faq/backend/faq-occupancy.server", () => ({
  loadFaqOccupancyStats: async () => ({
    averageReservationsPerDay: 1.2,
    coworkSeatCapacity: 28,
  }),
}));

const { generateMetadata } = await import("./page");

test("provides localized FAQ canonical and language alternates", async () => {
  requestLocale = "en-US";
  expect(await generateMetadata()).toMatchObject({
    title: "Frequenty Asked Questions | Deskohub Workspace",
    alternates: {
      canonical: "https://workspace.deskohub.cz/en-US/faq",
      languages: {
        "en-US": "https://workspace.deskohub.cz/en-US/faq",
        "cs-CZ": "https://workspace.deskohub.cz/cs-CZ/faq",
      },
    },
  });

  requestLocale = "cs-CZ";
  expect(await generateMetadata()).toMatchObject({
    title: "Časté otázky | Deskohub Workspace",
    alternates: {
      canonical: "https://workspace.deskohub.cz/cs-CZ/faq",
      languages: {
        "en-US": "https://workspace.deskohub.cz/en-US/faq",
        "cs-CZ": "https://workspace.deskohub.cz/cs-CZ/faq",
      },
    },
  });
});
