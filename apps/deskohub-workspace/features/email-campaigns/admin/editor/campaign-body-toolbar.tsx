"use client";

import { type Editor, useEditorState } from "@tiptap/react";
import { Effect, Option, Result } from "effect";
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
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
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { runWorkspaceBrowserEffectUntilAbort } from "@/shared/browser/workspace-browser-effect";
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
import type { CampaignBodyAttributeValue } from "../../body/campaign-body-document";
import {
  type CampaignImageAlignment,
  campaignBodyColumnWidth,
  defaultCampaignImageAlignment,
  isCampaignImageAlignment,
  isCampaignImageWidth,
} from "../../body/campaign-image";
import {
  type CampaignImageUploadStage,
  uploadCampaignImage,
} from "./campaign-image-upload";
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
    image: editor.isActive("image"),
    imageAlign: selectedImageAlignment(editor),
    imageWidth: editor.getAttributes("image").width,
    imagePosition: editor.state.selection.from,
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
          {state?.image && (
            <>
              <ImageAlignmentControl
                alignment={state.imageAlign}
                disabled={disabled}
                editor={editor}
                locale={locale}
              />
              <ImageWidthControl
                editor={editor}
                key={state.imagePosition}
                locale={locale}
                width={state.imageWidth}
              />
            </>
          )}
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

const imageAlignmentOptions = [
  {
    alignment: "left",
    Icon: AlignHorizontalJustifyStart,
    label: m.emailCampaignsImageAlignLeft,
  },
  {
    alignment: "center",
    Icon: AlignHorizontalJustifyCenter,
    label: m.emailCampaignsImageAlignCenter,
  },
  {
    alignment: "right",
    Icon: AlignHorizontalJustifyEnd,
    label: m.emailCampaignsImageAlignRight,
  },
] as const satisfies ReadonlyArray<{
  readonly alignment: CampaignImageAlignment;
  readonly Icon: typeof AlignHorizontalJustifyStart;
  readonly label: (...args: never) => string;
}>;

/** The selected image's alignment; one saved without any is centered. */
function selectedImageAlignment(editor: Editor): CampaignImageAlignment {
  const { align } = editor.getAttributes("image");
  return isCampaignImageAlignment(align)
    ? align
    : defaultCampaignImageAlignment;
}

/**
 * The selected image's width in pixels: its own, or else the natural width of
 * the picture the editor shows, so an image added before widths were kept
 * stops filling the column once it is aligned. Unknown while that picture
 * hasn't loaded; the image then keeps filling the column.
 */
function selectedImageWidth(editor: Editor): Option.Option<number> {
  const { width } = editor.getAttributes("image");
  if (isCampaignImageWidth(width)) return Option.some(width);
  const element = editor.view.nodeDOM(editor.state.selection.from);
  return element instanceof HTMLImageElement && element.naturalWidth > 0
    ? Option.some(element.naturalWidth)
    : Option.none();
}

/**
 * Aligns the selected image, shown only while one is selected. Aligning
 * records the image's width, which an image saved before widths were kept
 * lacks; without one it fills the column, so alignment would not show.
 */
function ImageAlignmentControl({
  alignment,
  disabled,
  editor,
  locale,
}: {
  readonly alignment: CampaignImageAlignment;
  readonly disabled: boolean;
  readonly editor: Editor | null;
  readonly locale: Locale;
}) {
  const align = (option: CampaignImageAlignment) => {
    if (!editor) return;
    const width = selectedImageWidth(editor);
    editor
      .chain()
      .focus()
      .updateAttributes(
        "image",
        Option.isSome(width)
          ? { align: option, width: width.value }
          : { align: option }
      )
      .run();
  };

  return imageAlignmentOptions.map(({ alignment: option, Icon, label }) => (
    <ToolbarToggle
      disabled={disabled}
      key={option}
      label={label({}, { locale })}
      onPressedChange={() => align(option)}
      pressed={alignment === option}
    >
      <Icon aria-hidden className="size-4" />
    </ToolbarToggle>
  ));
}

function ImageWidthControl({
  editor,
  locale,
  width,
}: {
  readonly editor: Editor | null;
  readonly locale: Locale;
  readonly width: CampaignBodyAttributeValue | undefined;
}) {
  const id = useId();
  const displayedWidth = Math.min(
    isCampaignImageWidth(width) ? width : campaignBodyColumnWidth,
    campaignBodyColumnWidth
  );
  const [previousWidth, setPreviousWidth] = useState(width);
  const [draft, setDraft] = useState(String(displayedWidth));
  if (previousWidth !== width) {
    setPreviousWidth(width);
    setDraft(String(displayedWidth));
  }
  const valid =
    isCampaignImageWidth(Number(draft)) &&
    Number(draft) <= campaignBodyColumnWidth;

  return (
    <div className="flex items-center gap-1.5 px-1">
      <Label className="text-xs" htmlFor={id}>
        {m.emailCampaignsImageWidth({}, { locale })}
      </Label>
      <Input
        aria-invalid={!valid}
        className="h-8 min-h-8 w-20 rounded-md px-2 py-1 text-sm"
        disabled={!editor}
        id={id}
        max={campaignBodyColumnWidth}
        min={1}
        onBlur={() => setDraft(String(displayedWidth))}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const pixels = Number(next);
          if (
            isCampaignImageWidth(pixels) &&
            pixels <= campaignBodyColumnWidth
          ) {
            editor?.commands.updateAttributes("image", {
              width: pixels,
              height: null,
            });
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            setDraft(String(displayedWidth));
            event.currentTarget.blur();
          }
        }}
        step={1}
        title={m.emailCampaignsImageWidthHint(
          { maxWidth: campaignBodyColumnWidth },
          { locale }
        )}
        type="number"
        value={draft}
      />
    </div>
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
  // The editor takes no other image until this one is in or has failed.
  const [stage, setStage] = useState<CampaignImageUploadStage>();
  const progress =
    stage &&
    (stage === "shrinking"
      ? m.emailCampaignsImageShrinking({}, { locale })
      : m.emailCampaignsImageUploading({}, { locale }));
  const busy = stage !== undefined;

  // Leaving the editor while an image is still uploading drops it, so none
  // is inserted into an editor that's gone.
  const lifetime = useRef<AbortSignal>(undefined);
  useEffect(() => {
    const mounted = new AbortController();
    lifetime.current = mounted.signal;
    return () => mounted.abort();
  }, []);

  const uploadImage = (file: File) => {
    if (!lifetime.current) return;
    setError(undefined);
    setStage("uploading");
    void uploadCampaignImage(file, locale, (next) =>
      Effect.sync(() => setStage(next))
    ).pipe(
      Effect.flatMap((uploaded) =>
        Effect.sync(() => {
          setStage(undefined);
          Result.match(uploaded, {
            onSuccess: ({ url, width }) =>
              editor
                ?.chain()
                .focus()
                .setImage({ src: url, alt: "", width })
                .run(),
            onFailure: setError,
          });
        })
      ),
      runWorkspaceBrowserEffectUntilAbort(
        "email-campaigns.admin.upload-image",
        lifetime.current
      )
    );
  };

  return (
    <>
      <ToolbarButton
        disabled={disabled || busy}
        label={progress || m.emailCampaignsImageUploadInsert({}, { locale })}
        onClick={() => fileInput.current?.click()}
      >
        {progress ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <ImagePlus aria-hidden className="size-4" />
        )}
      </ToolbarButton>
      <input
        // Any picture: Cloudinary converts the ones email clients can't show.
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) uploadImage(file);
        }}
        ref={fileInput}
        tabIndex={-1}
        type="file"
      />
      <span
        className={cn(
          "text-burned-orange-ink text-xs",
          !(progress || error) && "sr-only"
        )}
        role="status"
      >
        {progress || error}
      </span>
    </>
  );
}
