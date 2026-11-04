import { describe, expect, test } from "bun:test";
import {
  appendEmailTextListItem,
  emailTextListItemAt,
  emailTextListItemIdentity,
  emailTextListItemPathAfter,
  emailTextListTextKeys,
  indentEmailTextListItem,
  moveEmailTextListItem,
  outdentEmailTextListItem,
  removeEmailTextListItem,
  updateEmailTextListLevel,
} from "./email-block-text-list-items";

const nested = [
  {
    textKey: "a",
    list: {
      ordered: true,
      start: 3,
      items: [
        { textKey: "a1" },
        {
          textKey: "a2",
          list: { ordered: false, items: [{ textKey: "a2x" }] },
        },
      ],
    },
  },
  { textKey: "b" },
];

describe("text list items", () => {
  test("text keys include every nested level", () => {
    expect(emailTextListTextKeys(nested)).toEqual([
      "a",
      "a1",
      "a2",
      "a2x",
      "b",
    ]);
  });

  test("an item is appended to the block's level or under an item", () => {
    expect(appendEmailTextListItem([{ textKey: "a" }], [], "n")).toEqual([
      { textKey: "a" },
      { textKey: "n" },
    ]);
    expect(appendEmailTextListItem(nested, [0], "n")[0]?.list?.items).toEqual([
      { textKey: "a1" },
      nested[0]?.list?.items[1],
      { textKey: "n" },
    ]);
  });

  test("indenting keeps the moved item's own nested items", () => {
    const items = [{ textKey: "a" }, ...nested[0]!.list.items];
    expect(indentEmailTextListItem(items, [2], false)).toEqual([
      { textKey: "a" },
      {
        textKey: "a1",
        list: { ordered: false, items: [nested[0]!.list.items[1]!] },
      },
    ]);
    // The first item of a level has nothing to nest under.
    expect(indentEmailTextListItem(items, [0], false)).toEqual(items);
  });

  test("indenting into an existing level keeps that level's numbering", () => {
    expect(indentEmailTextListItem(nested, [1], false)[0]?.list).toEqual({
      ordered: true,
      start: 3,
      items: [...nested[0]!.list.items, { textKey: "b" }],
    });
  });

  test("outdenting places the item just after the one it was under", () => {
    expect(outdentEmailTextListItem(nested, [0, 1, 0])[0]?.list?.items).toEqual(
      [{ textKey: "a1" }, { textKey: "a2" }, { textKey: "a2x" }]
    );
    // An item of the block's own level stays where it is.
    expect(outdentEmailTextListItem(nested, [1])).toEqual(nested);
  });

  test("moving stays within the level and stops at its ends", () => {
    expect(
      moveEmailTextListItem(nested, [0, 0], 1)[0]?.list?.items.map(
        (item) => item.textKey
      )
    ).toEqual(["a2", "a1"]);
    expect(moveEmailTextListItem(nested, [0], -1)).toEqual(nested);
  });

  test("removing the last nested item drops its level", () => {
    expect(
      removeEmailTextListItem(nested, [0, 1, 0])[0]?.list?.items[1]
    ).toEqual({ textKey: "a2" });
    expect(removeEmailTextListItem(nested, [0])).toEqual([{ textKey: "b" }]);
  });

  test("a nested level's numbering changes on its own", () => {
    const next = updateEmailTextListLevel(nested, [0, 1], (level) => ({
      ...level,
      ordered: true,
    }));
    expect(next[0]?.list?.items[1]?.list?.ordered).toBe(true);
    expect(next[0]?.list?.ordered).toBe(true);
  });
});

describe("item identity", () => {
  test("items get distinct names however their text keys repeat", () => {
    const items = [
      { textKey: "a", list: { ordered: false, items: [{ textKey: "a" }] } },
      { textKey: "a@1" },
      { textKey: '["a",1]' },
      {},
      {},
    ];
    const names = [[0], [0, 0], [1], [2], [3], [4]].map((path) =>
      emailTextListItemIdentity(items, path)
    );
    expect(new Set(names).size).toBe(names.length);
  });

  test("a uniquely keyed item keeps its name wherever it moves", () => {
    const before = [{ textKey: "a" }, { textKey: "b" }];
    const after = moveEmailTextListItem(before, [1], -1);
    expect(emailTextListItemIdentity(after, [0])).toBe(
      emailTextListItemIdentity(before, [1])
    );
  });
});

describe("item destinations", () => {
  test("each move says where the item ends up", () => {
    expect(emailTextListItemPathAfter(nested, [1], "move-up")).toEqual([0]);
    expect(emailTextListItemPathAfter(nested, [0, 0], "move-down")).toEqual([
      0, 1,
    ]);
    expect(emailTextListItemPathAfter(nested, [1], "indent")).toEqual([0, 2]);
    expect(emailTextListItemPathAfter(nested, [0, 1, 0], "outdent")).toEqual([
      0, 2,
    ]);
    // The destinations match where the operations put the item.
    expect(
      emailTextListItemAt(indentEmailTextListItem(nested, [1], false), [0, 2])
        ?.textKey
    ).toBe("b");
    expect(
      emailTextListItemAt(outdentEmailTextListItem(nested, [0, 1, 0]), [0, 2])
        ?.textKey
    ).toBe("a2x");
  });
});
