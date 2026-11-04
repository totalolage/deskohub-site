import type { EmailDraftTextListItems } from "./email-draft-form";
import { moveEmailEntry } from "./email-structure-blocks";

/** One item of a text list, as the draft holds it. */
export type EmailTextListItem = EmailDraftTextListItems[number];

/** One level of a text list: the block's own, or one nested under an item. */
export type EmailTextListLevel = NonNullable<EmailTextListItem["list"]>;

/**
 * Where an item sits: its index in the block's own items, then in each
 * nested level down to it. `[1, 0]` is the first item under the second.
 */
export type EmailTextListItemPath = readonly number[];

/** Every text key in `items`, nested levels included. */
export const emailTextListTextKeys = (
  items: EmailDraftTextListItems | undefined
): readonly string[] =>
  (items ?? []).flatMap((item) => [
    ...(item.textKey ? [item.textKey] : []),
    ...emailTextListTextKeys(item.list?.items),
  ]);

/**
 * A name for the item at `path` that no other item of the list shares: its
 * text key, which follows it when it moves, or, for an item without one or
 * repeating an earlier item's key, its key and place.
 */
export const emailTextListItemIdentity = (
  items: EmailDraftTextListItems,
  path: EmailTextListItemPath
): string => {
  const textKey = emailTextListItemAt(items, path)?.textKey;
  const place = path.join(".");
  if (!textKey) return `@${place}`;
  return firstItemPlace(items, textKey) === place
    ? textKey
    : `${textKey}@${place}`;
};

/** The place of the first item, depth first, keyed `textKey`. */
const firstItemPlace = (
  items: EmailDraftTextListItems,
  textKey: string,
  prefix: EmailTextListItemPath = []
): string | undefined => {
  for (const [index, item] of items.entries()) {
    const path = [...prefix, index];
    if (item.textKey === textKey) return path.join(".");
    const nested = firstItemPlace(item.list?.items ?? [], textKey, path);
    if (nested !== undefined) return nested;
  }
  return undefined;
};

/** The item at `path`. */
export const emailTextListItemAt = (
  items: EmailDraftTextListItems,
  path: EmailTextListItemPath
): EmailTextListItem | undefined => {
  const [index, ...rest] = path;
  if (index === undefined) return undefined;
  const item = items[index];
  if (!item || rest.length === 0) return item;
  return emailTextListItemAt(item.list?.items ?? [], rest);
};

/** `item` with `items` as its nested level, or with no level once it is empty. */
const withNested = (
  item: EmailTextListItem,
  level: EmailTextListLevel,
  items: EmailDraftTextListItems
): EmailTextListItem => {
  const { list: _removed, ...rest } = item;
  return items.length > 0 ? { ...rest, list: { ...level, items } } : rest;
};

/**
 * `items` with the level that holds the item at `path` replaced by
 * `update(level items, index of the item)`. A nested level left empty is
 * dropped from its item.
 */
const updateLevel = (
  items: EmailDraftTextListItems,
  path: EmailTextListItemPath,
  update: (
    level: EmailDraftTextListItems,
    index: number
  ) => EmailDraftTextListItems
): EmailDraftTextListItems => {
  const [index, ...rest] = path;
  if (index === undefined) return items;
  if (rest.length === 0) return update(items, index);
  return items.map((item, position) => {
    if (position !== index || !item.list) return item;
    return withNested(
      item,
      item.list,
      updateLevel(item.list.items ?? [], rest, update)
    );
  });
};

/** `items` with a new item, keyed `textKey`, appended to the level `levelPath` names (`[]` for the block's own). */
export const appendEmailTextListItem = (
  items: EmailDraftTextListItems,
  levelPath: EmailTextListItemPath,
  textKey: string
): EmailDraftTextListItems => {
  if (levelPath.length === 0) return [...items, { textKey }];
  return updateLevel(items, levelPath, (level, index) =>
    level.map((item, position) =>
      position === index && item.list
        ? {
            ...item,
            list: {
              ...item.list,
              items: [...(item.list.items ?? []), { textKey }],
            },
          }
        : item
    )
  );
};

/** `items` without the item at `path` and everything nested under it. */
export const removeEmailTextListItem = (
  items: EmailDraftTextListItems,
  path: EmailTextListItemPath
): EmailDraftTextListItems =>
  updateLevel(items, path, (level, index) =>
    level.filter((_item, position) => position !== index)
  );

/** `items` with the item at `path` moved one place up or down its level. */
export const moveEmailTextListItem = (
  items: EmailDraftTextListItems,
  path: EmailTextListItemPath,
  offset: -1 | 1
): EmailDraftTextListItems =>
  updateLevel(items, path, (level, index) =>
    moveEmailEntry(level, index, offset)
  );

/**
 * `items` with the item at `path` moved under the item before it, at the end
 * of that item's nested level. A new nested level numbers its items as the
 * level it was made in does. The first item of a level can't be indented.
 */
export const indentEmailTextListItem = (
  items: EmailDraftTextListItems,
  path: EmailTextListItemPath,
  ordered: boolean
): EmailDraftTextListItems =>
  updateLevel(items, path, (level, index) => {
    const item = level[index];
    const previous = level[index - 1];
    if (!item || !previous) return level;
    const nested = previous.list ?? { ordered };
    const adopted = withNested(previous, nested, [
      ...(nested.items ?? []),
      item,
    ]);
    return level.flatMap((entry, position) => {
      if (position === index) return [];
      return position === index - 1 ? [adopted] : [entry];
    });
  });

/**
 * `items` with the nested item at `path` moved out of its level, to just
 * after the item it was under. An item of the block's own level stays.
 */
export const outdentEmailTextListItem = (
  items: EmailDraftTextListItems,
  path: EmailTextListItemPath
): EmailDraftTextListItems => {
  const parentPath = path.slice(0, -1);
  const index = path.at(-1);
  const item =
    index === undefined ? undefined : emailTextListItemAt(items, path);
  if (parentPath.length === 0 || !item) return items;
  return updateLevel(items, parentPath, (level, parentIndex) =>
    level.flatMap((entry, position) => {
      if (position !== parentIndex || !entry.list) return [entry];
      const remaining = (entry.list.items ?? []).filter(
        (_nested, nestedIndex) => nestedIndex !== index
      );
      return [withNested(entry, entry.list, remaining), item];
    })
  );
};

/** `items` with the nested level under the item at `path` changed by `change`. */
export const updateEmailTextListLevel = (
  items: EmailDraftTextListItems,
  path: EmailTextListItemPath,
  change: (level: EmailTextListLevel) => EmailTextListLevel
): EmailDraftTextListItems =>
  updateLevel(items, path, (level, index) =>
    level.map((item, position) =>
      position === index && item.list
        ? { ...item, list: change(item.list) }
        : item
    )
  );
