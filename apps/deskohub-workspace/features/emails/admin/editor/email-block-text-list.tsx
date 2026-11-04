"use client";

import {
  ArrowDown,
  ArrowUp,
  IndentDecrease,
  IndentIncrease,
  Plus,
  Trash2,
} from "lucide-react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import {
  EmailBlockNumberSetting,
  useEmailBlock,
  useEmailFocusAfterChange,
  useRemoveEmailTexts,
} from "./email-block-controls";
import { EmailBlockLinks } from "./email-block-links";
import {
  appendEmailTextListItem,
  type EmailTextListItemMove,
  type EmailTextListItemPath,
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
import {
  type EmailDraftTextListItems,
  newEmailEditorKey,
} from "./email-draft-form";
import {
  EmailFieldProblems,
  useEmailFieldProblems,
} from "./email-editor-context";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import { EmailInlineTextField } from "./email-inline-text-field";
import { withEmailSetting } from "./email-structure-blocks";

type ItemAction = "move-up" | "move-down" | "indent" | "outdent" | "remove";

/** The controls of one item, by their id suffix. */
type ItemControl = ItemAction | "ordered";

/** What a level's rows do to the block's items; each path names one item. */
type ItemOperations = {
  readonly itemsId: string;
  /** A name for the item at a path that no other item shares. */
  readonly identity: (path: EmailTextListItemPath) => string;
  readonly contentLocale: Locale;
  readonly links: Readonly<Record<string, string>> | undefined;
  readonly run: (action: ItemAction, path: EmailTextListItemPath) => void;
  readonly add: (levelPath: EmailTextListItemPath) => void;
  readonly setNestedOrdered: (
    path: EmailTextListItemPath,
    ordered: boolean
  ) => void;
};

const itemControlId = (
  itemsId: string,
  identity: string,
  control: ItemControl
) => `${itemsId}-${identity}-${control}`;

const itemActions = [
  {
    action: "move-up",
    Icon: ArrowUp,
    label: m.emailsEditorBlockListItemMoveUp,
  },
  {
    action: "move-down",
    Icon: ArrowDown,
    label: m.emailsEditorBlockListItemMoveDown,
  },
  {
    action: "outdent",
    Icon: IndentDecrease,
    label: m.emailsEditorBlockListItemOutdent,
  },
  {
    action: "indent",
    Icon: IndentIncrease,
    label: m.emailsEditorBlockListItemIndent,
  },
  { action: "remove", Icon: Trash2, label: m.emailsEditorBlockListItemRemove },
] as const satisfies readonly {
  readonly action: ItemAction;
  readonly Icon: typeof ArrowUp;
  readonly label: typeof m.emailsEditorBlockListItemRemove;
}[];

/**
 * The switch that numbers the items under one item. Its id follows the
 * block's setting ids, so it carries any problem placed on it like every
 * other control; the central problems currently mark the items group.
 */
function NestedOrderedSwitch({
  checked,
  fieldId,
  number,
  onChange,
}: {
  readonly checked: boolean;
  readonly fieldId: string;
  readonly number: string;
  readonly onChange: (ordered: boolean) => void;
}) {
  const locale = useRouteLocale();
  const { controlProps } = useEmailFieldProblems(fieldId);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Switch
          {...controlProps}
          checked={checked}
          id={fieldId}
          onCheckedChange={onChange}
        />
        <Label className="text-navy-blue text-xs" htmlFor={fieldId}>
          {m.emailsEditorBlockListNestedOrdered({ number }, { locale })}
        </Label>
      </div>
      <EmailFieldProblems fieldId={fieldId} />
    </div>
  );
}

/** One level of items; nested levels render under their item. */
function TextListLevel({
  items,
  levelPath,
  operations,
}: {
  readonly items: EmailDraftTextListItems;
  /** The item this level is nested under; `[]` for the block's own items. */
  readonly levelPath: EmailTextListItemPath;
  readonly operations: ItemOperations;
}) {
  const locale = useRouteLocale();
  const nested = levelPath.length > 0;
  return (
    <ol
      className={
        nested ? "space-y-3 border-navy-blue/12 border-l-2 pl-4" : "space-y-3"
      }
    >
      {items.map((item, index) => {
        const path = [...levelPath, index];
        const number = path.map((position) => position + 1).join(".");
        const identity = operations.identity(path);
        const disabled = {
          "move-up": index === 0,
          "move-down": index === items.length - 1,
          indent: index === 0,
          outdent: !nested,
          remove: false,
        } satisfies Record<ItemAction, boolean>;
        return (
          <li className="space-y-2" key={identity}>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                {item.textKey && (
                  <EmailInlineTextField
                    contentLocale={operations.contentLocale}
                    fieldId={emailEditorFieldIds.text(
                      operations.contentLocale,
                      item.textKey
                    )}
                    label={m.emailsEditorBlockListItem({ number }, { locale })}
                    links={operations.links}
                    mode="rich"
                    target={{ kind: "text", textKey: item.textKey }}
                  />
                )}
              </div>
              <div className="flex shrink-0 items-center">
                {itemActions.map(({ action, Icon, label }) => {
                  const name = label({ number }, { locale });
                  return (
                    <Button
                      aria-label={name}
                      disabled={disabled[action]}
                      id={itemControlId(operations.itemsId, identity, action)}
                      key={action}
                      onClick={() => operations.run(action, path)}
                      size="icon-sm"
                      title={name}
                      tone="muted"
                      type="button"
                      variant="ghost"
                    >
                      <Icon aria-hidden className="h-4 w-4" />
                    </Button>
                  );
                })}
              </div>
            </div>
            {item.list && (
              <div className="ml-4 space-y-2">
                <NestedOrderedSwitch
                  checked={item.list.ordered ?? false}
                  fieldId={itemControlId(
                    operations.itemsId,
                    identity,
                    "ordered"
                  )}
                  number={number}
                  onChange={(ordered) =>
                    operations.setNestedOrdered(path, ordered)
                  }
                />
                <TextListLevel
                  items={item.list.items ?? []}
                  levelPath={path}
                  operations={operations}
                />
                <Button
                  onClick={() => operations.add(path)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Plus aria-hidden className="h-4 w-4" />
                  {m.emailsEditorBlockListNestedItemAdd({ number }, { locale })}
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A text list's numbering, its items with their texts in `contentLocale`,
 * and its link destinations. Items move, nest under the item before them
 * and move back out with keyboard-operable buttons.
 */
export function EmailBlockTextListSettings({
  contentLocale,
  index,
}: {
  readonly contentLocale: Locale;
  readonly index: number;
}) {
  const locale = useRouteLocale();
  const [component, update] = useEmailBlock(index);
  const removeTexts = useRemoveEmailTexts();
  const focusAfterChange = useEmailFocusAfterChange();
  const orderedFieldId = emailEditorFieldIds.componentSetting(
    component?.id ?? "",
    "ordered"
  );
  const itemsId = emailEditorFieldIds.componentSetting(
    component?.id ?? "",
    "items"
  );
  const orderedProblems = useEmailFieldProblems(orderedFieldId);
  const itemsProblems = useEmailFieldProblems(itemsId);
  if (!component?.id) return null;
  const componentId = component.id;
  const items = component.items ?? [];
  const ordered = component.ordered ?? false;
  const setItems = (next: EmailDraftTextListItems) =>
    update({ ...component, items: next });

  const operations: ItemOperations = {
    itemsId,
    identity: (path) => emailTextListItemIdentity(items, path),
    contentLocale,
    links: component.links,
    run: (action, path) => {
      // Focus follows the item to its new place, where its controls may be
      // named differently when its text key repeats.
      const focusMoved = (
        next: EmailDraftTextListItems,
        move: EmailTextListItemMove,
        ...controls: ItemAction[]
      ) => {
        setItems(next);
        const identity = emailTextListItemIdentity(
          next,
          emailTextListItemPathAfter(items, path, move)
        );
        focusAfterChange([
          ...controls.map((control) =>
            itemControlId(itemsId, identity, control)
          ),
          itemsId,
        ]);
      };
      switch (action) {
        case "move-up":
          return focusMoved(
            moveEmailTextListItem(items, path, -1),
            action,
            "move-up",
            "move-down"
          );
        case "move-down":
          return focusMoved(
            moveEmailTextListItem(items, path, 1),
            action,
            "move-down",
            "move-up"
          );
        case "indent": {
          const levelOrdered =
            path.length > 1
              ? (emailTextListItemAt(items, path.slice(0, -1))?.list?.ordered ??
                false)
              : ordered;
          return focusMoved(
            indentEmailTextListItem(items, path, levelOrdered),
            action,
            "indent",
            "outdent"
          );
        }
        case "outdent":
          return focusMoved(
            outdentEmailTextListItem(items, path),
            action,
            "outdent",
            "indent"
          );
        case "remove": {
          const item = emailTextListItemAt(items, path);
          setItems(removeEmailTextListItem(items, path));
          removeTexts(emailTextListTextKeys(item ? [item] : []));
          return focusAfterChange([itemsId]);
        }
      }
    },
    add: (levelPath) => {
      const textKey = newEmailEditorKey("text");
      setItems(appendEmailTextListItem(items, levelPath, textKey));
      focusAfterChange([
        emailEditorFieldIds.text(contentLocale, textKey),
        itemsId,
      ]);
    },
    setNestedOrdered: (path, nestedOrdered) =>
      setItems(
        updateEmailTextListLevel(items, path, (level) =>
          withEmailSetting(
            { ...level, ordered: nestedOrdered },
            "start",
            nestedOrdered ? level.start : undefined
          )
        )
      ),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="space-y-1.5">
          <div className="flex h-9 items-center gap-2">
            <Switch
              {...orderedProblems.controlProps}
              checked={ordered}
              id={orderedFieldId}
              onCheckedChange={(next) =>
                update(
                  withEmailSetting(
                    { ...component, ordered: next },
                    "start",
                    next ? component.start : undefined
                  )
                )
              }
            />
            <Label className="text-navy-blue text-xs" htmlFor={orderedFieldId}>
              {m.emailsEditorBlockListOrdered({}, { locale })}
            </Label>
          </div>
          <EmailFieldProblems fieldId={orderedFieldId} />
        </div>
        {ordered && (
          <EmailBlockNumberSetting
            fieldId={emailEditorFieldIds.componentSetting(componentId, "start")}
            hint={m.emailsEditorBlockListStartHint({}, { locale })}
            label={m.emailsEditorBlockListStart({}, { locale })}
            min={0}
            onChange={(start) =>
              update(withEmailSetting(component, "start", start))
            }
            value={component.start}
          />
        )}
      </div>
      <fieldset
        {...itemsProblems.controlProps}
        className="space-y-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
        id={itemsId}
        tabIndex={-1}
      >
        <legend className="mb-2 font-semibold text-navy-blue text-xs">
          {m.emailsEditorBlockListItems({}, { locale })}
        </legend>
        <TextListLevel items={items} levelPath={[]} operations={operations} />
        <Button
          onClick={() => operations.add([])}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Plus aria-hidden className="h-4 w-4" />
          {m.emailsEditorBlockListItemAdd({}, { locale })}
        </Button>
      </fieldset>
      <EmailFieldProblems fieldId={itemsId} />
      <EmailBlockLinks index={index} />
    </div>
  );
}
