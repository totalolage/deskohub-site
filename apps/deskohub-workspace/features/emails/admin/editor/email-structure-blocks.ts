import { emailComponentTexts } from "@deskohub/workspace-admin-api";
import {
  type EmailDraftComponent,
  type EmailDraftComponentTag,
  type EmailDraftFormValues,
  newEmailEditorKey,
} from "./email-draft-form";

/** A kind of block the author can add; lists come bulleted or numbered. */
export type EmailBlockChoice =
  | Exclude<EmailDraftComponentTag, "TextList">
  | "BulletedList"
  | "NumberedList";

/** The add-block menu's choices, in menu order. */
export const emailBlockChoices = [
  "Paragraph",
  "Heading",
  "BulletedList",
  "NumberedList",
  "Divider",
  "Spacer",
  "Image",
  "Button",
  "Record",
  "List",
  "Offer",
] as const satisfies readonly EmailBlockChoice[];

const textKey = () => newEmailEditorKey("text");

/**
 * A new block of `choice` with a fresh id and fresh text keys. Settings the
 * author must choose, such as an image or a value, start unset.
 */
export const newEmailBlock = (
  choice: EmailBlockChoice
): EmailDraftComponent => {
  switch (choice) {
    case "Paragraph":
      return {
        _tag: "Paragraph",
        id: newEmailEditorKey("paragraph"),
        textKey: textKey(),
      };
    case "Heading":
      return {
        _tag: "Heading",
        id: newEmailEditorKey("heading"),
        textKey: textKey(),
        level: 2,
      };
    case "BulletedList":
    case "NumberedList":
      return {
        _tag: "TextList",
        id: newEmailEditorKey("textlist"),
        ordered: choice === "NumberedList",
        items: [{ textKey: textKey() }],
      };
    case "Image":
      return {
        _tag: "Image",
        id: newEmailEditorKey("image"),
        altKey: textKey(),
      };
    case "Button":
    case "Offer":
      return {
        _tag: choice,
        id: newEmailEditorKey(choice.toLowerCase()),
        labelKey: textKey(),
      };
    case "Divider":
    case "Spacer":
    case "Record":
    case "List":
      return { _tag: choice, id: newEmailEditorKey(choice.toLowerCase()) };
  }
};

/** The block kind as the author knows it; a text list by its numbering. */
export const emailBlockChoice = (
  component: EmailDraftComponent
): EmailBlockChoice => {
  if (component._tag !== "TextList") return component._tag;
  return component.ordered ? "NumberedList" : "BulletedList";
};

type Translations = NonNullable<EmailDraftFormValues["translations"]>;

/**
 * `translations` without the texts `textKeys` name, in every language,
 * including languages the editor doesn't show.
 */
export const withoutEmailTexts = (
  translations: Translations | undefined,
  textKeys: readonly string[]
): Translations | undefined => {
  if (!translations || textKeys.length === 0) return translations;
  const removed = new Set(textKeys);
  return Object.fromEntries(
    Object.entries(translations).map(([locale, translation]) => {
      if (!translation.texts) return [locale, translation];
      const texts = Object.fromEntries(
        Object.entries(translation.texts).filter(([key]) => !removed.has(key))
      );
      return [locale, { ...translation, texts }];
    })
  );
};

/** The text keys of `component`, its nested list items included. */
export const emailBlockTextKeys = (
  component: EmailDraftComponent
): readonly string[] =>
  emailComponentTexts(component).map(({ textKey }) => textKey);

/**
 * `list` with the entry at `index` moved `offset` places; unchanged when the
 * entry would leave the list.
 */
export const moveEmailEntry = <T>(
  list: readonly T[],
  index: number,
  offset: -1 | 1
): T[] => {
  const next = [...list];
  const entry = next[index];
  const other = next[index + offset];
  if (entry === undefined || other === undefined) return next;
  next[index] = other;
  next[index + offset] = entry;
  return next;
};

/**
 * `object` with `key` set to `value`, or without `key` when `value` is
 * `undefined`. Draft keys are exact: an unset setting has no key at all.
 */
export const withEmailSetting = <T extends object, K extends keyof T>(
  object: T,
  key: K,
  value: T[K] | undefined
): T => {
  const { [key]: _removed, ...rest } = object;
  return (value === undefined ? rest : { ...rest, [key]: value }) as T;
};
