import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getLocaleDefinition,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import type { AudienceFilterType } from "@deskohub/workspace-admin-api";
import { BunServices } from "@effect/platform-bun";
import { Effect, Option } from "effect";
import { InvalidMutationInputError } from "../command-runtime";
import {
  type ContentChangeFlags,
  campaignBodyFileName,
  campaignLocaleChoices,
  makeCampaignContentPatch,
  parseLocalizedValues,
  readAudienceFilter,
} from "./campaign-input";

test("reads and preserves completed coworking visit filters from inline JSON", async () => {
  const filter = {
    attribute: "reservationCount",
    _tag: "Condition",
    params: {
      dateBasis: "visitEnd",
      period: { _tag: "Past" },
      product: { family: "cowork", properties: [] },
    },
    operator: "eq",
    value: 1,
  } satisfies AudienceFilterType;
  const result = await Effect.runPromise(
    readAudienceFilter({
      filter: Option.some(JSON.stringify(filter)),
      filterFile: Option.none(),
    }).pipe(Effect.provide(BunServices.layer))
  );
  expect(Option.getOrThrow(result)).toEqual(filter);
});

const noContentChanges = {
  subject: [],
  preheader: [],
  body: [],
  operationalReason: [],
  clearOperationalReason: [],
  removeLocale: [],
} satisfies ContentChangeFlags;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

const writeBody = async (body: string) => {
  const directory = await mkdtemp(join(tmpdir(), "dhw-campaign-input-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "body.md");
  await writeFile(path, body);
  return path;
};

const contentPatch = (flags: Partial<ContentChangeFlags>) =>
  Effect.runPromise(
    makeCampaignContentPatch({ ...noContentChanges, ...flags }).pipe(
      Effect.provide(BunServices.layer)
    )
  );

const contentPatchFailure = (flags: Partial<ContentChangeFlags>) =>
  Effect.runPromise(
    makeCampaignContentPatch({ ...noContentChanges, ...flags }).pipe(
      Effect.flip,
      Effect.provide(BunServices.layer)
    )
  );

describe("makeCampaignContentPatch", () => {
  test("changes nothing without content flags", async () => {
    expect(Option.isNone(await contentPatch({}))).toBe(true);
  });

  test("patches only the given fields, in flag order, with trimmed reasons", async () => {
    const bodyPath = await writeBody("# Body\n");

    const patch = Option.getOrThrow(
      await contentPatch({
        subject: ["en=Subject"],
        preheader: ["cs=Náhled"],
        body: [`en=${bodyPath}`],
        operationalReason: ["cs=  Because  "],
      })
    );

    expect(Object.keys(patch)).toEqual(["en-US", "cs-CZ"]);
    expect(patch).toEqual({
      "en-US": { subject: "Subject", bodyMarkdown: "# Body\n" },
      "cs-CZ": { preheader: "Náhled", operationalReason: "Because" },
    });
  });

  test("clears a reason as null and removes a locale as null", async () => {
    expect(
      Option.getOrThrow(
        await contentPatch({
          clearOperationalReason: ["en-US"],
          removeLocale: ["cs-CZ"],
        })
      )
    ).toEqual({ "en-US": { operationalReason: null }, "cs-CZ": null });
  });

  test("removes a locale without other changes", async () => {
    expect(
      Option.getOrThrow(await contentPatch({ removeLocale: ["en-US"] }))
    ).toEqual({ "en-US": null });
  });

  test("checks set-and-clear before remove-and-change", async () => {
    const error = await contentPatchFailure({
      operationalReason: ["en=Why"],
      clearOperationalReason: ["en-US"],
      subject: ["cs=Ahoj"],
      removeLocale: ["cs-CZ"],
    });

    expect(error).toBeInstanceOf(InvalidMutationInputError);
    expect(error.message).toContain("en-US");
  });

  test("rejects removing a locale whose reason is cleared", async () => {
    const error = await contentPatchFailure({
      clearOperationalReason: ["cs-CZ"],
      removeLocale: ["cs-CZ"],
    });

    expect(error).toBeInstanceOf(InvalidMutationInputError);
    expect(error.message).toContain("cs-CZ");
  });

  test("validates flags before reading any body file", async () => {
    const error = await contentPatchFailure({
      body: ["en=./missing-body.md"],
      removeLocale: ["en-US"],
    });

    expect(error).toBeInstanceOf(InvalidMutationInputError);
    expect(error.message).not.toContain("missing-body.md");
  });
});

describe("campaign locale names", () => {
  test("accept each supported locale by its language subtag and its full tag", () => {
    expect(new Map(campaignLocaleChoices)).toEqual(
      new Map(
        supportedLocales.flatMap((locale) => [
          [getLocaleDefinition(locale).language, locale],
          [locale, locale],
        ])
      )
    );
    expect(campaignLocaleChoices).toHaveLength(supportedLocales.length * 2);
  });

  test("parse every short and full locale name in localized flags", async () => {
    for (const locale of supportedLocales) {
      const { language } = getLocaleDefinition(locale);
      for (const name of [language, locale]) {
        const values = await Effect.runPromise(
          parseLocalizedValues("subject", [`${name}=Hello`])
        );
        expect([...values]).toEqual([[locale, "Hello"]]);
      }
    }
  });

  test("reject a locale that isn't supported", async () => {
    const error = await Effect.runPromise(
      parseLocalizedValues("subject", ["xx=Hello"]).pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(InvalidMutationInputError);
  });

  test("export each locale's body to a file named for its language", () => {
    for (const locale of supportedLocales) {
      expect(campaignBodyFileName(locale)).toBe(
        `${getLocaleDefinition(locale).language}.md`
      );
    }
  });
});
