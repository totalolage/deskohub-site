import { describe, expect, test } from "bun:test";
import {
  getLocaleDefinition,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import { m } from "@/features/administration/i18n";
import type { EmailDraftFormValues } from "./email-draft-form";
import {
  fixtureDraft,
  fixtureImageCloudName,
} from "./email-editor.fixtures.test-utils";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import {
  emailEditorLanguageName,
  emailEditorLanguageProblemCount,
  emailEditorProblems,
  emailEnglishFallbackMissing,
  retiredEmailTranslationLocales,
} from "./email-editor-problems";

const locale = "en-US";
const problemsOf = (
  draft: EmailDraftFormValues,
  publishedImageSources: ReadonlySet<string> = new Set()
) =>
  emailEditorProblems({
    draft,
    // The Workspace's languages, as the editor host passes them.
    currentLocales: supportedLocales,
    locale,
    imageCloudName: fixtureImageCloudName,
    publishedImageSources,
  });

describe("emailEditorLanguageName", () => {
  test("names every Workspace language as the registry does", () => {
    for (const language of supportedLocales) {
      expect(emailEditorLanguageName(language)).toBe(
        getLocaleDefinition(language).nativeName
      );
    }
  });

  test("shows a language Workspace no longer serves as its code", () => {
    expect(emailEditorLanguageName("zz-ZZ")).toBe("zz-ZZ");
  });
});

describe("emailEditorProblems", () => {
  test("places a broken reference and an incomplete translation on their text fields", () => {
    const problems = problemsOf(fixtureDraft);
    expect(problems).toContainEqual({
      fieldId: emailEditorFieldIds.text("en-US", "paragraph-2-text"),
      locale: "en-US",
      message: m.emailsEditorProblemValueUnknown(
        { name: "last_visit" },
        { locale }
      ),
      place: m.emailsEditorPlaceBlockText(
        { number: 4, language: "English" },
        { locale }
      ),
    });
    expect(
      problems
        .filter((problem) => problem.locale === "cs-CZ")
        .map((problem) => problem.fieldId)
    ).toEqual([
      emailEditorFieldIds.text("cs-CZ", "paragraph-1-text"),
      emailEditorFieldIds.text("cs-CZ", "offer-1-label"),
      emailEditorFieldIds.text("cs-CZ", "paragraph-2-text"),
    ]);
    expect(emailEditorLanguageProblemCount(problems, "cs-CZ")).toBe(3);
    expect(emailEditorLanguageProblemCount(problems, "en-US")).toBe(1);
  });

  test("only a missing Czech translation blocks; other languages are optional", () => {
    const languageMissing = m.emailsEditorProblemLanguageMissing(
      {},
      { locale }
    );
    // The fixture has no Ukrainian or Slovak translation.
    expect(
      problemsOf(fixtureDraft).some(
        (problem) => problem.message === languageMissing
      )
    ).toBe(false);
    const { "cs-CZ": _czech, ...withoutCzech } =
      fixtureDraft.translations ?? {};
    expect(
      problemsOf({ ...fixtureDraft, translations: withoutCzech }).filter(
        (problem) => problem.message === languageMissing
      )
    ).toEqual([
      {
        fieldId: emailEditorFieldIds.translation("cs-CZ", "subject"),
        locale: "cs-CZ",
        message: languageMissing,
        place: expect.any(String),
      },
    ]);
  });

  test("never reports the unused definition", () => {
    expect(
      problemsOf(fixtureDraft).some((problem) =>
        problem.place.includes("unused_count")
      )
    ).toBe(false);
  });

  test("marks every use of a removed definition", () => {
    const problems = problemsOf({
      ...fixtureDraft,
      values: fixtureDraft.values?.filter(
        (definition) => definition.name !== "customer_name"
      ),
    });
    const unknown = m.emailsEditorProblemValueUnknown(
      { name: "customer_name" },
      { locale }
    );
    expect(
      problems
        .filter((problem) => problem.message === unknown)
        .map((problem) => problem.fieldId)
    ).toEqual(
      // Every language uses it in its subject and greeting, except the
      // incomplete Czech translation, which has only a subject.
      supportedLocales.flatMap((language) => [
        emailEditorFieldIds.translation(language, "subject"),
        ...(language === "cs-CZ"
          ? []
          : [emailEditorFieldIds.text(language, "paragraph-1-text")]),
      ])
    );
  });

  test("places settings, value and block problems on their controls", () => {
    const problems = problemsOf({
      translations: fixtureDraft.translations,
      values: [{ name: "Not Valid", source: { kind: "customer" } }],
      structure: [
        {
          _tag: "Button",
          id: "button-1",
          labelKey: "button-1-label",
          href: "http://insecure.test",
        },
        { _tag: "Offer", id: "offer-1", labelKey: "offer-1-label" },
      ],
    }).filter((problem) => !problem.locale);
    expect(problems.map((problem) => problem.fieldId)).toEqual([
      emailEditorFieldIds.purpose,
      emailEditorFieldIds.template,
      emailEditorFieldIds.componentSetting("button-1", "href"),
      emailEditorFieldIds.componentSetting("offer-1", "value"),
      emailEditorFieldIds.componentSetting("offer-1", "href"),
    ]);
  });

  test("places a discount that fails as a whole on its discount choice", () => {
    const problems = problemsOf({
      ...fixtureDraft,
      values: fixtureDraft.values?.map((definition) =>
        definition.name === "welcome_offer"
          ? {
              ...definition,
              source: { ...definition.source!, discountId: "not-a-uuid" },
            }
          : definition
      ),
    });
    expect(problems).toContainEqual(
      expect.objectContaining({
        fieldId: emailEditorFieldIds.valueSetting(1, "discountId"),
        message: m.emailsEditorProblemValueSource({}, { locale }),
      })
    );
  });

  test("places a retired language's problems on the control that removes it", () => {
    const problems = problemsOf({
      ...fixtureDraft,
      translations: {
        ...fixtureDraft.translations,
        "fr-FR": { subject: [] },
      },
    });
    const retired = problems.filter(
      (problem) =>
        problem.fieldId === emailEditorFieldIds.retiredTranslation("fr-FR")
    );
    expect(retired.length).toBeGreaterThan(0);
    expect(retired.every((problem) => problem.locale === undefined)).toBe(true);
    expect(
      retiredEmailTranslationLocales(
        { translations: { "fr-FR": {}, "en-US": {} } },
        supportedLocales
      )
    ).toEqual(["fr-FR"]);
  });

  test("refuses an image not uploaded through the editor unless it was published", () => {
    // From the account, but not an untransformed editor upload.
    const foreign =
      "https://res.cloudinary.com/cloud/image/upload/c_fill,w_10/v1/other/photo.png";
    const draft: EmailDraftFormValues = {
      ...fixtureDraft,
      structure: [
        ...(fixtureDraft.structure ?? []),
        { _tag: "Image", id: "image-1", src: foreign, altKey: "image-1-alt" },
      ],
    };
    const imageProblem = {
      fieldId: emailEditorFieldIds.componentSetting("image-1", "src"),
      locale: undefined,
      message: m.emailsEditorProblemImageNotAllowed({}, { locale }),
      place: m.emailsEditorPlaceBlock({ number: 5 }, { locale }),
    };
    expect(problemsOf(draft)).toContainEqual(imageProblem);
    expect(problemsOf(draft, new Set([foreign]))).not.toContainEqual(
      imageProblem
    );
  });
});

describe("emailEnglishFallbackMissing", () => {
  test("holds while the draft has no English translation", () => {
    const { "en-US": _english, ...withoutEnglish } =
      fixtureDraft.translations ?? {};
    expect(emailEnglishFallbackMissing(fixtureDraft)).toBe(false);
    expect(
      emailEnglishFallbackMissing({
        ...fixtureDraft,
        translations: withoutEnglish,
      })
    ).toBe(true);
    expect(emailEnglishFallbackMissing({})).toBe(true);
  });
});
