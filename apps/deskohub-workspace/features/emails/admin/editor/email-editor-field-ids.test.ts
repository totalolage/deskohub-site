import { describe, expect, test } from "bun:test";
import {
  emailEditorFieldIds,
  emailEditorProblemsId,
} from "./email-editor-field-ids";

describe("emailEditorFieldIds", () => {
  test("never contain whitespace, so aria-describedby names one element", () => {
    const id = emailEditorFieldIds.text("en-US", "intro text\twith\nbreaks");
    expect(id).not.toMatch(/\s/);
    expect(emailEditorProblemsId(id)).not.toMatch(/\s/);
  });

  test("keep fields apart whatever their keys hold", () => {
    const ids = [
      emailEditorFieldIds.text("en-US", "a.b"),
      emailEditorFieldIds.text("en-US.a", "b"),
      emailEditorFieldIds.text("en", "US-a.b"),
      emailEditorFieldIds.component("block"),
      emailEditorFieldIds.component("block.href"),
      emailEditorFieldIds.componentSetting("block", "href"),
      emailEditorFieldIds.componentLink("block", "href"),
      `${emailEditorFieldIds.component("block")}-remove`,
      emailEditorFieldIds.component("block-remove"),
      emailEditorFieldIds.component("block_2d_remove"),
      emailEditorFieldIds.value(1),
      emailEditorFieldIds.valueSetting(1, "name"),
      emailEditorFieldIds.translation("en-US", "subject"),
      emailEditorFieldIds.text("en-US", "subject"),
      emailEditorFieldIds.retiredTranslation("en-US"),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
