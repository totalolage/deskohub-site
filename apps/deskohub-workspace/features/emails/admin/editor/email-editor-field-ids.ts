import type { EmailTranslationField } from "./email-draft-form";

/**
 * DOM ids of the editor's fields. Problems name their field by these ids, so
 * a field marks itself invalid and the problem summary can focus it. Every
 * field component sets its control's `id` from here.
 */
export const emailEditorFieldIds = {
  purpose: "email-editor-purpose",
  template: "email-editor-template",
  /** The control that adds a block; an empty body points here. */
  addBlock: "email-editor-add-block",
  /** A language's subject, preheader or operational reason. */
  translation: (locale: string, field: EmailTranslationField) =>
    `email-editor-${locale}-${field}`,
  /** A block's translated text in one language. */
  text: (locale: string, textKey: string) =>
    `email-editor-${locale}-text-${textKey}`,
  /** A block's focusable container, for problems with no narrower field. */
  component: (componentId: string) => `email-editor-component-${componentId}`,
  /**
   * One shared setting of a block: `href`, `src`, `value`, `fields`,
   * `level`, `items`, `sort`, `limit`, `ordered`, `align` or `width`.
   */
  componentSetting: (componentId: string, setting: string) =>
    `email-editor-component-${componentId}-${setting}`,
  /** The destination input of one of a block's shared links. */
  componentLink: (componentId: string, linkKey: string) =>
    `email-editor-component-${componentId}-link-${linkKey}`,
  /** A value definition's focusable container. */
  value: (index: number) => `email-editor-value-${index}`,
  /**
   * One setting of a value definition: `name`, `path`, `fields`, `sort`,
   * `limit`, `discountId`, `validDays`, `maxUses` or `maxUsesPerCustomer`.
   */
  valueSetting: (index: number, setting: string) =>
    `email-editor-value-${index}-${setting}`,
} as const;

/** The id of the element that describes a field's problems. */
export const emailEditorProblemsId = (fieldId: string) => `${fieldId}-problems`;
