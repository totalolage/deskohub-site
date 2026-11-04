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

/** A block whose only setting is its id; the author picks the rest. */
const newBareBlock = (
  tag: "Divider" | "Spacer" | "Record" | "List"
): EmailDraftComponent => ({
  _tag: tag,
  id: newEmailEditorKey(tag.toLowerCase()),
});

/** A block with a label to write, such as a button's. */
const newLabelledBlock = (tag: "Button" | "Offer"): EmailDraftComponent => ({
  _tag: tag,
  id: newEmailEditorKey(tag.toLowerCase()),
  labelKey: textKey(),
});

/** A text list with one empty item, numbered or bulleted. */
const newTextList = (ordered: boolean): EmailDraftComponent => ({
  _tag: "TextList",
  id: newEmailEditorKey("textlist"),
  ordered,
  items: [{ textKey: textKey() }],
});

/** How to start a new block of each choice. */
const newBlockOfChoice = {
  Paragraph: () => ({
    _tag: "Paragraph",
    id: newEmailEditorKey("paragraph"),
    textKey: textKey(),
  }),
  Heading: () => ({
    _tag: "Heading",
    id: newEmailEditorKey("heading"),
    textKey: textKey(),
    level: 2,
  }),
  BulletedList: () => newTextList(false),
  NumberedList: () => newTextList(true),
  Divider: () => newBareBlock("Divider"),
  Spacer: () => newBareBlock("Spacer"),
  Image: () => ({
    _tag: "Image",
    id: newEmailEditorKey("image"),
    altKey: textKey(),
  }),
  Button: () => newLabelledBlock("Button"),
  Record: () => newBareBlock("Record"),
  List: () => newBareBlock("List"),
  Offer: () => newLabelledBlock("Offer"),
} satisfies Record<EmailBlockChoice, () => EmailDraftComponent>;

/**
 * A new block of `choice` with a fresh id and fresh text keys. Settings the
 * author must choose, such as an image or a value, start unset.
 */
export const newEmailBlock = (choice: EmailBlockChoice): EmailDraftComponent =>
  newBlockOfChoice[choice]();

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
 * A name for the entry at `index` of `keys` that no other entry shares, even
 * where keys repeat or are missing: its key and how many earlier entries
 * have the same one. The encoding is injective, so no key imitates another
 * entry's name, and it is safe inside an element id.
 */
export const emailKeyOccurrence = (
  keys: readonly (string | undefined)[],
  index: number
): string => {
  const key = keys[index] ?? "";
  const earlier = keys
    .slice(0, index)
    .filter((other) => (other ?? "") === key).length;
  return encodeURIComponent(JSON.stringify([key, earlier]));
};

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
