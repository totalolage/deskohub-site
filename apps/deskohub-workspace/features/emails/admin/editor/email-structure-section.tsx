"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useRef } from "react";
import { useWatch } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  EmailBlockCard,
  emailBlockActionId,
  emailBlockKindLabels,
} from "./email-block-card";
import {
  useEmailFocusAfterChange,
  useRemoveEmailTexts,
} from "./email-block-controls";
import { useEmailDraftForm } from "./email-draft-form";
import {
  EmailFieldProblems,
  useEmailFieldProblems,
} from "./email-editor-context";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import {
  emailBlockChoices,
  emailBlockTextKeys,
  moveEmailEntry,
  newEmailBlock,
} from "./email-structure-blocks";

/**
 * A block's React key: its id, so a moved block keeps its state. A block
 * sharing an earlier block's id, which the problems report, adds its place.
 */
const blockKey = (
  structure: readonly { readonly id?: string }[],
  component: { readonly id?: string },
  index: number
) =>
  structure.findIndex((other) => other.id === component.id) === index
    ? `block-${component.id ?? ""}`
    : `block-${component.id ?? ""}-${index}`;

/** The menu that appends a block of any kind to the body. */
function AddBlockMenu({
  onAdd,
}: {
  /** Adds a block; answers the id of the element that takes focus. */
  readonly onAdd: (choice: (typeof emailBlockChoices)[number]) => string;
}) {
  const locale = useRouteLocale();
  const { controlProps } = useEmailFieldProblems(emailEditorFieldIds.addBlock);
  // The new block takes focus once the menu has closed; focusing it while the
  // menu still traps focus would be undone.
  const added = useRef<string>(undefined);
  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-describedby={controlProps["aria-describedby"]}
            aria-invalid={controlProps["aria-invalid"]}
            id={emailEditorFieldIds.addBlock}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Plus aria-hidden className="h-4 w-4" />
            {m.emailsEditorStructureAddBlock({}, { locale })}
            <ChevronDown aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(event) => {
            const fieldId = added.current;
            if (!fieldId) return;
            added.current = undefined;
            event.preventDefault();
            document.getElementById(fieldId)?.focus();
          }}
        >
          {emailBlockChoices.map((choice) => (
            <DropdownMenuItem
              key={choice}
              onSelect={() => {
                added.current = onAdd(choice);
              }}
            >
              {emailBlockKindLabels[choice]({}, { locale })}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <EmailFieldProblems fieldId={emailEditorFieldIds.addBlock} />
    </div>
  );
}

/**
 * The shared body structure, with each block's translated texts in
 * `contentLocale` inline under it. Blocks are added from a menu and moved or
 * removed with buttons; removing one deletes its texts in every language.
 */
export function EmailStructureSection({
  contentLocale,
}: {
  readonly contentLocale: Locale;
}) {
  const locale = useRouteLocale();
  const { control, getValues, setValue } = useEmailDraftForm();
  const structure = useWatch({ control, name: "structure" }) ?? [];
  const removeTexts = useRemoveEmailTexts();
  const focusAfterChange = useEmailFocusAfterChange();
  const setStructure = (next: typeof structure) =>
    setValue("structure", next, { shouldDirty: true });

  const add = (choice: (typeof emailBlockChoices)[number]) => {
    const block = newEmailBlock(choice);
    setStructure([...(getValues("structure") ?? []), block]);
    return emailEditorFieldIds.component(block.id ?? "");
  };
  const move = (index: number, offset: -1 | 1) => {
    const componentId = structure[index]?.id ?? "";
    setStructure(moveEmailEntry(structure, index, offset));
    const [pressed, other] =
      offset < 0
        ? (["move-up", "move-down"] as const)
        : (["move-down", "move-up"] as const);
    focusAfterChange([
      emailBlockActionId(componentId, pressed),
      emailBlockActionId(componentId, other),
      emailEditorFieldIds.component(componentId),
    ]);
  };
  const remove = (index: number) => {
    const component = structure[index];
    if (!component) return;
    setStructure(structure.filter((_block, at) => at !== index));
    removeTexts(emailBlockTextKeys(component));
    const neighbour = structure[index + 1] ?? structure[index - 1];
    focusAfterChange([
      ...(neighbour?.id ? [emailEditorFieldIds.component(neighbour.id)] : []),
      emailEditorFieldIds.addBlock,
    ]);
  };

  return (
    <section
      aria-labelledby="email-editor-structure-heading"
      className="space-y-4"
    >
      <div className="space-y-1">
        <h2
          className="font-semibold text-lg text-navy-blue"
          id="email-editor-structure-heading"
        >
          {m.emailsEditorStructureHeading({}, { locale })}
        </h2>
        <p className="text-navy-blue/70 text-sm">
          {m.emailsEditorStructureNote({}, { locale })}
        </p>
      </div>
      {structure.length === 0 ? (
        <p className="rounded-lg border border-navy-blue/20 border-dashed px-4 py-6 text-center text-navy-blue/60 text-sm">
          {m.emailsEditorStructureEmpty({}, { locale })}
        </p>
      ) : (
        <ol
          aria-label={m.emailsEditorStructureBlocksLabel({}, { locale })}
          className="space-y-3"
        >
          {structure.map((component, index) => (
            <EmailBlockCard
              contentLocale={contentLocale}
              count={structure.length}
              index={index}
              key={blockKey(structure, component, index)}
              onMove={move}
              onRemove={remove}
            />
          ))}
        </ol>
      )}
      <AddBlockMenu onAdd={add} />
    </section>
  );
}
