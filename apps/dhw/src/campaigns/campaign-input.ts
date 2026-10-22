import {
  type AdministrationCampaignContentType,
  type AdministrationCampaignLocaleContentChangeType,
  type AdministrationCampaignLocaleType,
  type AdministrationCampaignUpdateInputType,
  AudienceFilter,
  type AudienceFilterType,
} from "@deskohub/workspace-admin-api";
import { Effect, FileSystem, Option } from "effect";
import { Flag } from "effect/unstable/cli";
import { InvalidMutationInputError } from "../command-runtime";
import { decodeJsonInput, readJsonInputFile } from "../json-input";

/** Short locale names accepted on the command line, mapped to API locales. */
export const campaignLocaleChoices = [
  ["cs", "cs-CZ"],
  ["en", "en-US"],
  ["cs-CZ", "cs-CZ"],
  ["en-US", "en-US"],
] as const satisfies ReadonlyArray<
  readonly [string, AdministrationCampaignLocaleType]
>;

const campaignLocales = new Map<string, AdministrationCampaignLocaleType>(
  campaignLocaleChoices
);

/** File name a locale's body is exported to, such as `cs.md`. */
export const campaignBodyFileName = (
  locale: AdministrationCampaignLocaleType
) => `${locale.slice(0, 2)}.md`;

export const campaignLocaleFlag = (name: string) =>
  Flag.choiceWithValue(name, campaignLocaleChoices);

/** A repeatable `--<name> <locale>=<value>` flag. */
export const localizedFlag = (name: string, description: string, min = 0) =>
  Flag.string(name).pipe(
    Flag.atLeast(min),
    Flag.withDescription(
      `${description}, as <locale>=<value> where the locale is cs or en; repeat per locale`
    )
  );

export type LocalizedValues = ReadonlyMap<
  AdministrationCampaignLocaleType,
  string
>;

/** Parses repeated `<locale>=<value>` flag values into one value per locale. */
export const parseLocalizedValues = (
  flag: string,
  entries: ReadonlyArray<string>
) =>
  Effect.gen(function* () {
    const values = new Map<AdministrationCampaignLocaleType, string>();
    for (const entry of entries) {
      const separator = entry.indexOf("=");
      if (separator === -1) {
        return yield* new InvalidMutationInputError({
          message: `--${flag} expects <locale>=<value>, such as cs=…, but got "${entry}".`,
        });
      }
      const locale = yield* parseCampaignLocale(
        flag,
        entry.slice(0, separator)
      );
      if (values.has(locale)) {
        return yield* new InvalidMutationInputError({
          message: `--${flag} sets ${locale} more than once.`,
        });
      }
      values.set(locale, entry.slice(separator + 1));
    }
    return values as LocalizedValues;
  });

const parseCampaignLocale = (flag: string, value: string) =>
  Option.match(Option.fromUndefinedOr(campaignLocales.get(value)), {
    onNone: () =>
      Effect.fail(
        new InvalidMutationInputError({
          message: `--${flag} has an unknown locale "${value}". Use cs, en, cs-CZ, or en-US.`,
        })
      ),
    onSome: Effect.succeed,
  });

/**
 * Trims a text flag value. The contract trims these fields and rejects blank
 * ones, and the typed client checks the trimmed form before sending.
 */
export const requireText = (flag: string, value: string) => {
  const trimmed = value.trim();
  return trimmed === ""
    ? Effect.fail(
        new InvalidMutationInputError({
          message: `--${flag} must not be blank.`,
        })
      )
    : Effect.succeed(trimmed);
};

const requireLocalizedText = (flag: string, values: LocalizedValues) =>
  Effect.gen(function* () {
    const trimmed = new Map<AdministrationCampaignLocaleType, string>();
    for (const [locale, value] of values) {
      trimmed.set(locale, yield* requireText(`${flag} ${locale}`, value));
    }
    return trimmed as LocalizedValues;
  });

/** Fails when a repeated locale flag names the same locale twice. */
export const requireDistinctLocales = (
  flag: string,
  locales: ReadonlyArray<AdministrationCampaignLocaleType>
) => {
  const repeated = locales.find(
    (locale, index) => locales.indexOf(locale) !== index
  );
  return repeated === undefined
    ? Effect.succeed(new Set(locales))
    : Effect.fail(
        new InvalidMutationInputError({
          message: `--${flag} names ${repeated} more than once.`,
        })
      );
};

/** Reads one Markdown body file per locale. */
export const readBodies = (paths: LocalizedValues) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const bodies = new Map<AdministrationCampaignLocaleType, string>();
    for (const [locale, path] of paths) {
      const body = yield* fileSystem.readFileString(path).pipe(
        Effect.mapError(
          () =>
            new InvalidMutationInputError({
              message: `The ${locale} body file ${path} could not be read.`,
            })
        )
      );
      bodies.set(locale, body);
    }
    return bodies as LocalizedValues;
  });

export interface LocalizedContentFlags {
  readonly subject: ReadonlyArray<string>;
  readonly preheader: ReadonlyArray<string>;
  readonly body: ReadonlyArray<string>;
  readonly operationalReason: ReadonlyArray<string>;
}

const parseLocalizedContentFlags = (flags: LocalizedContentFlags) =>
  Effect.all({
    subjects: parseLocalizedValues("subject", flags.subject),
    preheaders: parseLocalizedValues("preheader", flags.preheader),
    bodyPaths: parseLocalizedValues("body", flags.body),
    operationalReasons: parseLocalizedValues(
      "operational-reason",
      flags.operationalReason
    ).pipe(
      Effect.flatMap((values) =>
        requireLocalizedText("operational-reason", values)
      )
    ),
  });

const localesOf = (...values: ReadonlyArray<LocalizedValues>) =>
  new Set(values.flatMap((map) => [...map.keys()]));

/**
 * Builds a new campaign's per-locale content. Every locale named by any flag
 * needs a subject and a body; the preheader defaults to empty.
 */
export const makeCampaignContent = (flags: LocalizedContentFlags) =>
  Effect.gen(function* () {
    const { bodyPaths, operationalReasons, preheaders, subjects } =
      yield* parseLocalizedContentFlags(flags);
    const locales = localesOf(
      subjects,
      preheaders,
      bodyPaths,
      operationalReasons
    );
    for (const locale of locales) {
      if (!subjects.has(locale) || !bodyPaths.has(locale)) {
        return yield* new InvalidMutationInputError({
          message: `${locale} needs both --subject and --body.`,
        });
      }
    }
    const bodies = yield* readBodies(bodyPaths);
    const content: Partial<
      Record<
        AdministrationCampaignLocaleType,
        NonNullable<
          AdministrationCampaignContentType[AdministrationCampaignLocaleType]
        >
      >
    > = {};
    for (const locale of locales) {
      const operationalReason = operationalReasons.get(locale);
      content[locale] = {
        subject: subjects.get(locale) ?? "",
        preheader: preheaders.get(locale) ?? "",
        bodyMarkdown: bodies.get(locale) ?? "",
        ...(operationalReason !== undefined && { operationalReason }),
      };
    }
    return content satisfies AdministrationCampaignContentType;
  });

export interface ContentChangeFlags extends LocalizedContentFlags {
  readonly clearOperationalReason: ReadonlyArray<AdministrationCampaignLocaleType>;
  readonly removeLocale: ReadonlyArray<AdministrationCampaignLocaleType>;
}

type ContentPatch = NonNullable<
  AdministrationCampaignUpdateInputType["content"]
>;

/**
 * Builds the `content` patch of a campaign update. Locales without flags stay
 * unchanged, a removed locale maps to null, and a cleared operational reason
 * maps to null. Returns none when no flag changes content.
 */
export const makeCampaignContentPatch = (flags: ContentChangeFlags) =>
  Effect.gen(function* () {
    const { bodyPaths, operationalReasons, preheaders, subjects } =
      yield* parseLocalizedContentFlags(flags);
    const cleared = yield* requireDistinctLocales(
      "clear-operational-reason",
      flags.clearOperationalReason
    );
    const removed = yield* requireDistinctLocales(
      "remove-locale",
      flags.removeLocale
    );
    for (const locale of cleared) {
      if (operationalReasons.has(locale)) {
        return yield* new InvalidMutationInputError({
          message: `${locale} can't both set and clear its operational reason.`,
        });
      }
    }
    const changed = localesOf(
      subjects,
      preheaders,
      bodyPaths,
      operationalReasons
    );
    for (const locale of cleared) changed.add(locale);
    for (const locale of removed) {
      if (changed.has(locale)) {
        return yield* new InvalidMutationInputError({
          message: `${locale} can't be removed and changed in the same update.`,
        });
      }
    }
    if (changed.size === 0 && removed.size === 0) {
      return Option.none<ContentPatch>();
    }
    const bodies = yield* readBodies(bodyPaths);
    const patch: {
      -readonly [Locale in keyof ContentPatch]: ContentPatch[Locale];
    } = {};
    for (const locale of changed) {
      const subject = subjects.get(locale);
      const preheader = preheaders.get(locale);
      const bodyMarkdown = bodies.get(locale);
      const operationalReason = cleared.has(locale)
        ? null
        : operationalReasons.get(locale);
      patch[locale] = {
        ...(subject !== undefined && { subject }),
        ...(preheader !== undefined && { preheader }),
        ...(bodyMarkdown !== undefined && { bodyMarkdown }),
        ...(operationalReason !== undefined && { operationalReason }),
      } satisfies AdministrationCampaignLocaleContentChangeType;
    }
    for (const locale of removed) patch[locale] = null;
    return Option.some<ContentPatch>(patch);
  });

/**
 * Reads an audience filter from `--filter-file` or `--filter` and decodes it
 * with the strict contract schema. Returns none when neither flag is given.
 */
export const readAudienceFilter = ({
  filter,
  filterFile,
}: {
  readonly filter: Option.Option<string>;
  readonly filterFile: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    if (Option.isSome(filter) && Option.isSome(filterFile)) {
      return yield* new InvalidMutationInputError({
        message: "Pass either --filter or --filter-file, not both.",
      });
    }
    if (Option.isSome(filterFile)) {
      return Option.some(
        yield* readJsonInputFile(
          AudienceFilter,
          "audience filter",
          filterFile.value
        )
      );
    }
    if (Option.isSome(filter)) {
      return Option.some(
        yield* decodeJsonInput(AudienceFilter, "audience filter", filter.value)
      );
    }
    return Option.none<AudienceFilterType>();
  });
