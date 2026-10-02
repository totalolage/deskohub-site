import { expect, mock, test } from "bun:test";
import type { Locale } from "@/features/i18n";

let requestLocale: Locale = "en-US";

mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (resolve: (locale: Locale) => unknown) =>
    Promise.resolve(resolve(requestLocale)),
}));

const { generateMetadata } = await import("./page");

test("provides localized Team canonical and language alternates", async () => {
  requestLocale = "en-US";
  expect(await generateMetadata()).toMatchObject({
    title: "Our team | Deskohub Workspace",
    alternates: {
      canonical: "https://workspace.deskohub.cz/en-US/team",
      languages: {
        "en-US": "https://workspace.deskohub.cz/en-US/team",
        "cs-CZ": "https://workspace.deskohub.cz/cs-CZ/team",
      },
    },
  });

  requestLocale = "cs-CZ";
  expect(await generateMetadata()).toMatchObject({
    title: "Náš tým | Deskohub Workspace",
    alternates: {
      canonical: "https://workspace.deskohub.cz/cs-CZ/team",
      languages: {
        "en-US": "https://workspace.deskohub.cz/en-US/team",
        "cs-CZ": "https://workspace.deskohub.cz/cs-CZ/team",
      },
    },
  });
});
