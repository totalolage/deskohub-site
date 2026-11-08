import type { EmailTranslationField } from "./email-draft-form";

/**
 * One id segment for any key: letters and digits stay, every other
 * character becomes `_<hex code point>_`. Keys may hold spaces, which would
 * split `aria-describedby` lists, or separators, which could make two
 * fields' ids equal.
 */
const segment = (key: string | number): string =>
  String(key).replace(
    /[^A-Za-z0-9]/gu,
    (character) => `_${character.codePointAt(0)?.toString(16)}_`
  );

/** An id from fixed kind names and keys, unambiguous for any keys. */
const fieldId = (...parts: readonly (string | number)[]): string =>
  ["email-editor", ...parts.map(segment)].join(".");

/**
 * DOM ids of the editor's fields. Problems name their field by these ids, so
 * a field marks itself invalid and the problem summary can focus it. Every
 * field component sets its control's `id` from here. Ids contain no
 * whitespace, and an id with a `-suffix` appended never equals another id.
 */
export const emailEditorFieldIds = {
  purpose: fieldId("purpose"),
  template: fieldId("template"),
  /** The control that adds a block; an empty body points here. */
  addBlock: fieldId("addBlock"),
  /** A language's subject, preheader or operational reason. */
  translation: (locale: string, field: EmailTranslationField) =>
    fieldId("translation", locale, field),
  /** A block's translated text in one language. */
  text: (locale: string, textKey: string) => fieldId("text", locale, textKey),
  /**
   * The control that removes a stored translation in a language the
   * Workspace no longer offers; its problems point here.
   */
  retiredTranslation: (locale: string) => fieldId("retiredTranslation", locale),
  /** A block's focusable container, for problems with no narrower field. */
  component: (componentId: string) => fieldId("component", componentId),
  /**
   * One shared setting of a block: `href`, `src`, `value`, `fields`,
   * `level`, `items`, `sort`, `limit`, `ordered`, `align` or `width`.
   */
  componentSetting: (componentId: string, setting: string) =>
    fieldId("component", componentId, setting),
  /** The destination input of one of a block's shared links. */
  componentLink: (componentId: string, linkKey: string) =>
    fieldId("componentLink", componentId, linkKey),
  /** A value definition's focusable container. */
  value: (index: number) => fieldId("value", index),
  /**
   * One setting of a value definition: `name`, `path`, `fields`, `sort`,
   * `limit`, `discountId`, `validDays`, `maxUses` or `maxUsesPerCustomer`.
   */
  valueSetting: (index: number, setting: string) =>
    fieldId("value", index, setting),
} as const;

/** The id of the element that describes a field's problems. */
export const emailEditorProblemsId = (id: string) => `${id}-problems`;
