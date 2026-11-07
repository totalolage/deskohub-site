// Checks that the workspace packages the app shares with the web apps resolve
// through Metro and run on the app's engine.
import { parseAcceptLanguage } from "@deskohub/i18n/core";
import { getLocaleFromPathname } from "@deskohub/i18n/pathname";
import { getTranslatedValue } from "@deskohub/i18n/translatable";
import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import type { SmokeCase } from "./smoke-case";
import { assertSmoke } from "./smoke-case";

const Visitor = Schema.Struct({
  name: Schema.NonEmptyString,
  age: Schema.Number,
});

export const sharedSmokeCases: ReadonlyArray<SmokeCase> = [
  {
    group: "shared",
    name: "standard-schema-decode",
    run: () => {
      const standardVisitor = Schema.toStandardSchemaV1(Visitor);
      const valid = decodeStandardSchema(standardVisitor, {
        name: "Ada",
        age: 1,
      });
      const invalid = decodeStandardSchema(standardVisitor, {
        name: "",
        age: 1,
      });
      const actual = `valid=${JSON.stringify(valid)} invalid=${String(invalid)}`;
      assertSmoke(valid?.name === "Ada" && invalid === undefined, actual);
      return actual;
    },
  },
  {
    group: "shared",
    name: "i18n-core-pathname-translatable",
    run: () => {
      const preferred = parseAcceptLanguage("cs-cz,cs;q=0.9,en;q=0.8")[0]
        ?.normalizedLocaleToken;
      const pathnameLocale = getLocaleFromPathname("/en-US/faq", [
        "cs",
        "en-US",
      ] as const);
      const translated = getTranslatedValue(
        { cs: "Ahoj", en: "Hello" },
        "en-US"
      );
      const actual = `preferred=${preferred} pathname=${pathnameLocale} translated=${translated}`;
      assertSmoke(
        preferred === "cs-CZ" &&
          pathnameLocale === "en-US" &&
          translated === "Hello",
        actual
      );
      return actual;
    },
  },
];
