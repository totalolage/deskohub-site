import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import type { EmailDraftFormValues } from "./email-draft-form";
import {
  fixtureDraft,
  fixtureImageCloudName,
} from "./email-editor.fixtures.test-utils";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import {
  emailEditorLanguageProblemCount,
  emailEditorProblems,
  retiredEmailTranslationLocales,
} from "./email-editor-problems";

const locale = "en-US";
const problemsOf = (
  draft: EmailDraftFormValues,
  publishedImageSources: ReadonlySet<string> = new Set()
) =>
  emailEditorProblems({
    draft,
    currentLocales: ["cs-CZ", "en-US"],
    locale,
    imageCloudName: fixtureImageCloudName,
    publishedImageSources,
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
        { number: 4, language: m.emailsEditorLanguageEnglish({}, { locale }) },
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
    ).toEqual([
      emailEditorFieldIds.translation("en-US", "subject"),
      emailEditorFieldIds.text("en-US", "paragraph-1-text"),
      emailEditorFieldIds.translation("cs-CZ", "subject"),
    ]);
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
        "de-DE": { subject: [] },
      },
    });
    const retired = problems.filter(
      (problem) =>
        problem.fieldId === emailEditorFieldIds.retiredTranslation("de-DE")
    );
    expect(retired.length).toBeGreaterThan(0);
    expect(retired.every((problem) => problem.locale === undefined)).toBe(true);
    expect(
      retiredEmailTranslationLocales(
        { translations: { "de-DE": {}, "en-US": {} } },
        ["cs-CZ", "en-US"]
      )
    ).toEqual(["de-DE"]);
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
