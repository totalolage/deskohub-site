"use client";

import { type Editor, useEditorState } from "@tiptap/react";
import {
  Bold,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  MousePointerClick,
  Redo2,
  Undo2,
} from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Toggle } from "@/shared/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { getEmailCampaignAdminActionFailureMessage } from "../action-failure-message";
import { uploadCampaignImage } from "./actions";
import { normalizeCampaignLinkHref } from "./campaign-link-href";
import { CtaButtonDialog, type CtaButtonValues } from "./cta-button-dialog";

type BlockType = "paragraph" | "h1" | "h2" | "h3";

const headingLevels = { h1: 1, h2: 2, h3: 3 } as const;

const selectToolbarState = ({ editor }: { editor: Editor | null }) =>
  editor && {
    blockType: (["h1", "h2", "h3"] as const).find((block) =>
      editor.isActive("heading", { level: headingLevels[block] })
    ) satisfies BlockType | undefined,
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    link: editor.isActive("link"),
    linkHref: String(editor.getAttributes("link").href ?? ""),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    ctaButton: editor.isActive("ctaButton"),
    ctaLabel: String(editor.getAttributes("ctaButton").label ?? ""),
    ctaHref: String(editor.getAttributes("ctaButton").href ?? ""),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };

/** Formatting controls for the campaign body editor. */
export function CampaignBodyToolbar({
  editor,
}: {
  readonly editor: Editor | null;
}) {
  const locale = useRouteLocale();
  // useEditorState selects again only on a transaction, so before the first
  // one (usually focus) it still holds the selection from the null editor.
  const state =
    useEditorState({ editor, selector: selectToolbarState }) ??
    selectToolbarState({ editor });
  const [ctaDialogOpen, setCtaDialogOpen] = useState(false);
  const disabled = !editor || !state;
  const blockType: BlockType = state?.blockType ?? "paragraph";
  const chain = () => editor?.chain().focus();

  const setBlockType = (next: BlockType) => {
    if (next === "paragraph") chain()?.setParagraph().run();
    else chain()?.setHeading({ level: headingLevels[next] }).run();
  };

  const submitCtaButton = (values: CtaButtonValues) => {
    if (state?.ctaButton) {
      chain()?.updateAttributes("ctaButton", values).run();
    } else {
      chain()?.insertContent({ type: "ctaButton", attrs: values }).run();
    }
  };

  return (
    <TooltipProvider>
      <div
        aria-label={m.emailCampaignsEditorToolbar({}, { locale })}
        className="flex items-start gap-1 border-navy-blue/10 border-b bg-navy-blue/[0.03] px-2 py-1.5"
        role="toolbar"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <Select
            disabled={disabled}
            // Inside a form, Radix's hidden native select reports "" once
            // the value changes before the menu ever opened; applying that
            // would steal focus into the editor.
            onValueChange={(value) => {
              if (value) setBlockType(value as BlockType);
            }}
            value={blockType}
          >
            <SelectTrigger
              aria-label={m.emailCampaignsEditorTextStyle({}, { locale })}
              className="h-8 min-h-8 w-[8.5rem] rounded-md px-2.5 py-1 text-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="paragraph">
                {m.emailCampaignsEditorParagraph({}, { locale })}
              </SelectItem>
              <SelectItem value="h1">
                {m.emailCampaignsEditorHeading1({}, { locale })}
              </SelectItem>
              <SelectItem value="h2">
                {m.emailCampaignsEditorHeading2({}, { locale })}
              </SelectItem>
              <SelectItem value="h3">
                {m.emailCampaignsEditorHeading3({}, { locale })}
              </SelectItem>
            </SelectContent>
          </Select>
          <ToolbarSeparator />
          <ToolbarToggle
            disabled={disabled}
            label={m.emailCampaignsEditorBold({}, { locale })}
            onPressedChange={() => chain()?.toggleBold().run()}
            pressed={state?.bold ?? false}
          >
            <Bold aria-hidden className="size-4" />
          </ToolbarToggle>
          <ToolbarToggle
            disabled={disabled}
            label={m.emailCampaignsEditorItalic({}, { locale })}
            onPressedChange={() => chain()?.toggleItalic().run()}
            pressed={state?.italic ?? false}
          >
            <Italic aria-hidden className="size-4" />
          </ToolbarToggle>
          <LinkControl
            active={state?.link ?? false}
            currentHref={state?.linkHref ?? ""}
            disabled={disabled}
            editor={editor}
            locale={locale}
          />
          <ToolbarSeparator />
          <ToolbarToggle
            disabled={disabled}
            label={m.emailCampaignsEditorBulletList({}, { locale })}
            onPressedChange={() => chain()?.toggleBulletList().run()}
            pressed={state?.bulletList ?? false}
          >
            <List aria-hidden className="size-4" />
          </ToolbarToggle>
          <ToolbarToggle
            disabled={disabled}
            label={m.emailCampaignsEditorNumberedList({}, { locale })}
            onPressedChange={() => chain()?.toggleOrderedList().run()}
            pressed={state?.orderedList ?? false}
          >
            <ListOrdered aria-hidden className="size-4" />
          </ToolbarToggle>
          <ToolbarSeparator />
          <ImageUploadControl
            disabled={disabled}
            editor={editor}
            locale={locale}
          />
          <ToolbarButton
            disabled={disabled}
            label={
              state?.ctaButton
                ? m.emailCampaignsCtaEdit({}, { locale })
                : m.emailCampaignsCtaInsert({}, { locale })
            }
            onClick={() => setCtaDialogOpen(true)}
          >
            <MousePointerClick aria-hidden className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            disabled={disabled}
            label={m.emailCampaignsEditorDivider({}, { locale })}
            onClick={() => chain()?.setHorizontalRule().run()}
          >
            <Minus aria-hidden className="size-4" />
          </ToolbarButton>
        </div>
        <div className="flex shrink-0 items-center gap-1 border-navy-blue/10 border-l pl-1">
          <ToolbarButton
            disabled={!state?.canUndo}
            label={m.emailCampaignsEditorUndo({}, { locale })}
            onClick={() => chain()?.undo().run()}
          >
            <Undo2 aria-hidden className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            disabled={!state?.canRedo}
            label={m.emailCampaignsEditorRedo({}, { locale })}
            onClick={() => chain()?.redo().run()}
          >
            <Redo2 aria-hidden className="size-4" />
          </ToolbarButton>
        </div>
      </div>
      <CtaButtonDialog
        initialValues={
          state?.ctaButton
            ? { label: state.ctaLabel, href: state.ctaHref }
            : undefined
        }
        onOpenChange={setCtaDialogOpen}
        onRemove={
          state?.ctaButton
            ? () => {
                setCtaDialogOpen(false);
                chain()?.deleteSelection().run();
              }
            : undefined
        }
        onSubmit={submitCtaButton}
        open={ctaDialogOpen}
      />
    </TooltipProvider>
  );
}

function ToolbarSeparator() {
  return <div aria-hidden className="mx-1 h-5 w-px bg-navy-blue/15" />;
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

function ToolbarToggle({
  children,
  disabled,
  label,
  onPressedChange,
  pressed,
}: {
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly label: string;
  readonly onPressedChange: () => void;
  readonly pressed: boolean;
}) {
  return (
    <ToolbarHint label={label}>
      <Toggle
        aria-label={label}
        disabled={disabled}
        onPressedChange={onPressedChange}
        pressed={pressed}
      >
        {children}
      </Toggle>
    </ToolbarHint>
  );
}

function ToolbarButton({
  children,
  disabled,
  label,
  onClick,
}: {
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <ToolbarHint label={label}>
      <Button
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        size="icon-sm"
        tone="muted"
        type="button"
        variant="ghost"
      >
        {children}
      </Button>
    </ToolbarHint>
  );
}

function LinkControl({
  active,
  currentHref,
  disabled,
  editor,
  locale,
}: {
  readonly active: boolean;
  readonly currentHref: string;
  readonly disabled: boolean;
  readonly editor: Editor | null;
  readonly locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");
  const [error, setError] = useState<string>();
  const inputId = useId();
  const errorId = useId();

  const applyLink = () => {
    const normalized = normalizeCampaignLinkHref(href);
    if (!normalized) {
      setError(m.emailCampaignsLinkHrefHint({}, { locale }));
      return;
    }
    const chain = editor?.chain().focus().extendMarkRange("link");
    if (editor?.state.selection.empty && !active) {
      chain
        ?.insertContent({
          type: "text",
          text: normalized.replace(/^mailto:/, ""),
          marks: [{ type: "link", attrs: { href: normalized } }],
        })
        .run();
    } else {
      chain?.setLink({ href: normalized }).run();
    }
    setOpen(false);
  };

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setHref(currentHref);
          setError(undefined);
        }
        setOpen(nextOpen);
      }}
      open={open}
    >
      <ToolbarHint label={m.emailCampaignsLinkToggle({}, { locale })}>
        <PopoverTrigger asChild>
          <Toggle
            aria-label={m.emailCampaignsLinkToggle({}, { locale })}
            disabled={disabled}
            pressed={active}
          >
            <Link2 aria-hidden className="size-4" />
          </Toggle>
        </PopoverTrigger>
      </ToolbarHint>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>
            {m.emailCampaignsLinkHrefLabel({}, { locale })}
          </Label>
          <Input
            aria-describedby={errorId}
            id={inputId}
            aria-invalid={error !== undefined}
            autoFocus
            inputMode="url"
            onChange={(event) => {
              setHref(event.target.value);
              setError(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
            }}
            placeholder="https://"
            value={href}
          />
        </div>
        <p
          className="text-burned-orange-ink text-xs empty:hidden"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
        <div className="flex justify-end gap-2">
          {active && (
            <Button
              className="mr-auto"
              onClick={() => {
                editor
                  ?.chain()
                  .focus()
                  .extendMarkRange("link")
                  .unsetLink()
                  .run();
                setOpen(false);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {m.emailCampaignsLinkRemove({}, { locale })}
            </Button>
          )}
          <Button onClick={applyLink} size="sm" type="button">
            {active
              ? m.emailCampaignsLinkUpdate({}, { locale })
              : m.emailCampaignsLinkAdd({}, { locale })}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ImageUploadControl({
  disabled,
  editor,
  locale,
}: {
  readonly disabled: boolean;
  readonly editor: Editor | null;
  readonly locale: Locale;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const upload = useWorkspaceAction(uploadCampaignImage, {
    actionName: "uploadCampaignImage",
    onSuccess: ({ data }) => {
      setError(undefined);
      editor?.chain().focus().setImage({ src: data.url, alt: "" }).run();
    },
    onError: ({ error }) =>
      setError(
        getEmailCampaignAdminActionFailureMessage(error.serverError, {
          fallback:
            error.validationErrors?.formErrors?.[0] ??
            m.emailCampaignsImageUploadFailed({}, { locale }),
          locale,
        })
      ),
  });

  return (
    <>
      <ToolbarButton
        disabled={disabled || upload.isExecuting}
        label={
          upload.isExecuting
            ? m.emailCampaignsImageUploading({}, { locale })
            : m.emailCampaignsImageUploadInsert({}, { locale })
        }
        onClick={() => fileInput.current?.click()}
      >
        {upload.isExecuting ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <ImagePlus aria-hidden className="size-4" />
        )}
      </ToolbarButton>
      <input
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const formData = new FormData();
          formData.set("file", file);
          upload.execute(formData);
        }}
        ref={fileInput}
        tabIndex={-1}
        type="file"
      />
      <span
        className={cn("text-burned-orange-ink text-xs", !error && "sr-only")}
        role="status"
      >
        {upload.isExecuting
          ? m.emailCampaignsImageUploading({}, { locale })
          : error}
      </span>
    </>
  );
}
