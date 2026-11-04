"use client";

import { type Editor, useEditorState } from "@tiptap/react";
import { Bold, Braces, Italic, Link2 } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { Toggle } from "@/shared/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import type { EmailDraftValueDefinition } from "./email-draft-form";
import {
  emailInlineLinkKey,
  emailInlineLinkMark,
  emailInlineValueNode,
} from "./email-inline-parts";
import {
  type EmailScalarValueOption,
  emailScalarValueOptions,
  emailValueReferenceLabel,
} from "./email-value-options";

const selectMarks = ({ editor }: { editor: Editor | null }) => {
  if (!editor) return undefined;
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    link: emailInlineLinkKey(editor.getAttributes(emailInlineLinkMark)),
  };
};

/**
 * The controls of one inline text editor: bold, italic and links for rich
 * texts, and value references for every text.
 */
export function EmailInlineTextToolbar({
  definitions,
  editor,
  links,
  mode,
}: {
  readonly definitions: readonly EmailDraftValueDefinition[];
  readonly editor: Editor | null;
  readonly links: Readonly<Record<string, string>>;
  readonly mode: "rich" | "plain";
}) {
  const locale = useRouteLocale();
  return (
    <TooltipProvider>
      <div
        aria-label={m.emailsEditorInlineToolbarLabel({}, { locale })}
        className="flex shrink-0 items-center gap-0.5 py-0.5"
        role="toolbar"
      >
        {mode === "rich" && (
          <EmailInlineFormatting
            editor={editor}
            links={links}
            locale={locale}
          />
        )}
        <EmailInlineValuePicker
          definitions={definitions}
          editor={editor}
          locale={locale}
        />
      </div>
    </TooltipProvider>
  );
}

function ToolbarHint({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function EmailInlineFormatting({
  editor,
  links,
  locale,
}: {
  readonly editor: Editor | null;
  readonly links: Readonly<Record<string, string>>;
  readonly locale: Locale;
}) {
  // useEditorState selects again only on a transaction, so until the first
  // one it still holds the selection from the null editor.
  const marks =
    useEditorState({ editor, selector: selectMarks }) ??
    selectMarks({ editor });
  const boldLabel = m.emailsEditorInlineBold({}, { locale });
  const italicLabel = m.emailsEditorInlineItalic({}, { locale });
  return (
    <>
      <ToolbarHint label={boldLabel}>
        <Toggle
          aria-label={boldLabel}
          disabled={!editor}
          onPressedChange={() => editor?.chain().focus().toggleBold().run()}
          pressed={marks?.bold ?? false}
        >
          <Bold aria-hidden className="size-4" />
        </Toggle>
      </ToolbarHint>
      <ToolbarHint label={italicLabel}>
        <Toggle
          aria-label={italicLabel}
          disabled={!editor}
          onPressedChange={() => editor?.chain().focus().toggleItalic().run()}
          pressed={marks?.italic ?? false}
        >
          <Italic aria-hidden className="size-4" />
        </Toggle>
      </ToolbarHint>
      <EmailInlineLinkPicker
        currentLink={marks?.link}
        editor={editor}
        links={links}
        locale={locale}
      />
    </>
  );
}

function EmailInlineLinkPicker({
  currentLink,
  editor,
  links,
  locale,
}: {
  readonly currentLink: string | undefined;
  readonly editor: Editor | null;
  readonly links: Readonly<Record<string, string>>;
  readonly locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  // Whether the menu closes on a choice, which hands focus back to the text.
  const chose = useRef(false);
  const hintId = useId();
  const destinations = Object.entries(links);
  const hasDestinations = destinations.length > 0;
  // A link to a removed destination can still be removed.
  const available =
    Boolean(editor) && (hasDestinations || currentLink !== undefined);
  const label = m.emailsEditorInlineLink({}, { locale });
  const unavailableHint = m.emailsEditorInlineLinkNone({}, { locale });

  const applyLink = (key: string | undefined) => {
    if (!editor) return;
    chose.current = true;
    const chain = editor.chain();
    // A caret inside a link changes or removes that whole link.
    if (editor.state.selection.empty)
      chain.extendMarkRange(emailInlineLinkMark);
    if (key === undefined) chain.unsetMark(emailInlineLinkMark).run();
    else chain.setMark(emailInlineLinkMark, { key }).run();
  };

  return (
    <DropdownMenu
      onOpenChange={(next) => setOpen(next && available)}
      open={open}
    >
      <ToolbarHint label={hasDestinations ? label : unavailableHint}>
        <DropdownMenuTrigger asChild>
          {/* Pressed while the caret is in a link. It stays focusable when the
          block has no destinations, so its hint can explain why. */}
          <Toggle
            aria-describedby={hasDestinations ? undefined : hintId}
            aria-disabled={!available || undefined}
            aria-label={label}
            className="aria-disabled:opacity-50"
            pressed={currentLink !== undefined}
          >
            <Link2 aria-hidden className="size-4" />
          </Toggle>
        </DropdownMenuTrigger>
      </ToolbarHint>
      <span className="sr-only" id={hintId}>
        {!hasDestinations && unavailableHint}
      </span>
      <DropdownMenuContent
        align="end"
        className="max-w-80"
        onCloseAutoFocus={(event) => {
          if (!chose.current) return;
          chose.current = false;
          event.preventDefault();
          editor?.commands.focus();
        }}
      >
        {destinations.map(([key, href]) => (
          <DropdownMenuCheckboxItem
            checked={currentLink === key}
            key={key}
            onSelect={() => applyLink(key)}
          >
            <span className="truncate">{href || key}</span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={currentLink === undefined}
          onSelect={() => applyLink(undefined)}
        >
          {m.emailsEditorInlineLinkRemove({}, { locale })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const optionValue = ({ name, field }: EmailScalarValueOption) =>
  JSON.stringify([name, ...(field ?? [])]);

function EmailInlineValuePicker({
  definitions,
  editor,
  locale,
}: {
  readonly definitions: readonly EmailDraftValueDefinition[];
  readonly editor: Editor | null;
  readonly locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  // Whether the list closes on a choice, which hands focus back to the text.
  const chose = useRef(false);
  const options = emailScalarValueOptions(definitions);
  const label = m.emailsEditorInlineValueInsert({}, { locale });
  const searchLabel = m.emailsEditorInlineValueSearch({}, { locale });
  const discountFields = new Map([
    ["code", m.emailsEditorInlineValueDiscountCode({}, { locale })],
    ["expiresAt", m.emailsEditorInlineValueDiscountExpiry({}, { locale })],
  ]);
  const description = ({ name, field }: EmailScalarValueOption) => {
    const discount = definitions.some(
      (definition) =>
        definition.name === name && definition.source?.kind === "discount"
    );
    return discount && field?.[0] !== undefined
      ? discountFields.get(field[0])
      : undefined;
  };

  const insert = (option: EmailScalarValueOption) => {
    if (!editor) return;
    chose.current = true;
    editor
      .chain()
      .insertContent({
        type: emailInlineValueNode,
        attrs: {
          name: option.name,
          field: option.field ? [...option.field] : null,
        },
      })
      .run();
    setOpen(false);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <ToolbarHint label={label}>
        <PopoverTrigger asChild>
          <Button
            aria-label={label}
            disabled={!editor}
            size="icon-sm"
            tone="muted"
            type="button"
            variant="ghost"
          >
            <Braces aria-hidden className="size-4" />
          </Button>
        </PopoverTrigger>
      </ToolbarHint>
      <PopoverContent
        align="end"
        className="w-72 p-0"
        onCloseAutoFocus={(event) => {
          if (!chose.current) return;
          chose.current = false;
          event.preventDefault();
          editor?.commands.focus();
        }}
      >
        <Command label={searchLabel}>
          <CommandInput placeholder={searchLabel} />
          <CommandList>
            {options.map((option) => {
              const reference = emailValueReferenceLabel(option);
              const hint = description(option);
              return (
                <CommandItem
                  key={optionValue(option)}
                  keywords={hint ? [reference, hint] : [reference]}
                  onSelect={() => insert(option)}
                  value={optionValue(option)}
                >
                  <span className="min-w-0 truncate font-mono">
                    {reference}
                  </span>
                  {hint && (
                    <span className="ml-auto shrink-0 text-navy-blue/60 text-xs">
                      {hint}
                    </span>
                  )}
                </CommandItem>
              );
            })}
          </CommandList>
          <CommandEmpty>
            {options.length > 0
              ? m.emailsEditorInlineValueNoMatch({}, { locale })
              : m.emailsEditorInlineValueNone({}, { locale })}
          </CommandEmpty>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
