"use client";

import { Effect, Result } from "effect";
import { ImagePlus, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { runWorkspaceBrowserEffectUntilAbort } from "@/shared/browser/workspace-browser-effect";
import { Button } from "@/shared/components/ui/button";
import {
  EmailBlockLabelText,
  EmailBlockNumberSetting,
  EmailBlockSelectSetting,
  EmailBlockTextSetting,
  useEmailBlock,
} from "./email-block-controls";
import {
  type EmailDraftComponent,
  useEmailDraftForm,
} from "./email-draft-form";
import {
  EmailFieldProblems,
  useEmailFieldProblems,
} from "./email-editor-context";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import {
  type EmailImageUploadStage,
  uploadEmailImage,
} from "./email-image-upload";
import { withEmailSetting } from "./email-structure-blocks";

type ImageAlignment = NonNullable<EmailDraftComponent["align"]>;

const imageAlignments = {
  left: m.emailsEditorBlockImageAlignLeft,
  center: m.emailsEditorBlockImageAlignCenter,
  right: m.emailsEditorBlockImageAlignRight,
} as const satisfies Record<
  ImageAlignment,
  typeof m.emailsEditorBlockImageAlignLeft
>;

const isImageAlignment = (value: string): value is ImageAlignment =>
  Object.hasOwn(imageAlignments, value);

/**
 * Uploads the block's picture straight to Cloudinary and sets it as the
 * block's source. The stage and any failure are announced in regions that
 * stay mounted.
 */
function ImageUpload({
  componentId,
  onUploaded,
  src,
}: {
  readonly componentId: string;
  readonly onUploaded: (src: string) => void;
  readonly src: string | undefined;
}) {
  const locale = useRouteLocale();
  const fieldId = emailEditorFieldIds.componentSetting(componentId, "src");
  const { controlProps } = useEmailFieldProblems(fieldId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  // The block takes no other image until this one is in or has failed.
  const [stage, setStage] = useState<EmailImageUploadStage>();
  const progress =
    stage &&
    {
      shrinking: m.emailsEditorBlockImageShrinking,
      uploading: m.emailsEditorBlockImageUploading,
    }[stage]({}, { locale });

  // Leaving the editor while an image is still uploading drops it, so the
  // form of an editor that's gone isn't changed.
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
    void uploadEmailImage(file, locale, (next) =>
      Effect.sync(() => setStage(next))
    ).pipe(
      Effect.flatMap((uploaded) =>
        Effect.sync(() => {
          setStage(undefined);
          Result.match(uploaded, {
            onSuccess: ({ url }) => onUploaded(url),
            onFailure: setError,
          });
        })
      ),
      runWorkspaceBrowserEffectUntilAbort(
        "emails.admin.editor.upload-image",
        lifetime.current
      )
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {src ? (
          // biome-ignore lint/performance/noImgElement: a Cloudinary image the author uploaded, shown as it is.
          <img
            alt=""
            className="h-20 w-auto max-w-40 rounded-md border border-navy-blue/12 bg-navy-blue/[0.03] object-contain"
            src={src}
          />
        ) : (
          <p className="text-navy-blue/60 text-sm">
            {m.emailsEditorBlockImageNone({}, { locale })}
          </p>
        )}
        <Button
          aria-describedby={controlProps["aria-describedby"]}
          aria-invalid={controlProps["aria-invalid"]}
          disabled={stage !== undefined}
          id={fieldId}
          onClick={() => fileInput.current?.click()}
          size="sm"
          type="button"
          variant="secondary"
        >
          {stage ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus aria-hidden className="h-4 w-4" />
          )}
          {src
            ? m.emailsEditorBlockImageReplace({}, { locale })
            : m.emailsEditorBlockImageUpload({}, { locale })}
        </Button>
        <input
          // Any picture: Cloudinary converts the ones email clients can't show.
          accept="image/*"
          aria-hidden
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
      </div>
      <p className="text-navy-blue/70 text-xs" role="status">
        {progress}
      </p>
      <p className="text-burned-orange-ink text-sm" role="alert">
        {error}
      </p>
      <EmailFieldProblems fieldId={fieldId} />
    </div>
  );
}

/**
 * An image's shared picture, alignment, width and link, and its alternative
 * text in `contentLocale`. An uploaded picture keeps no width until the
 * author sets one, so it fills the column.
 */
export function EmailBlockImageSettings({
  contentLocale,
  index,
}: {
  readonly contentLocale: Locale;
  readonly index: number;
}) {
  const locale = useRouteLocale();
  const [component, update] = useEmailBlock(index);
  const { getValues, setValue } = useEmailDraftForm();
  if (!component?.id) return null;
  const componentId = component.id;
  // The upload ends later: the block may have moved or changed meanwhile.
  const setUploadedSource = (src: string) => {
    const at = (getValues("structure") ?? []).findIndex(
      (block) => block.id === componentId
    );
    if (at >= 0) setValue(`structure.${at}.src`, src, { shouldDirty: true });
  };
  const setting = (name: string) =>
    emailEditorFieldIds.componentSetting(componentId, name);
  return (
    <div className="space-y-4">
      <ImageUpload
        componentId={componentId}
        onUploaded={setUploadedSource}
        src={component.src}
      />
      <div className="flex flex-wrap items-start gap-4">
        <EmailBlockSelectSetting
          fieldId={setting("align")}
          label={m.emailsEditorBlockImageAlign({}, { locale })}
          onChange={(align) => {
            if (isImageAlignment(align)) update({ ...component, align });
          }}
          options={Object.entries(imageAlignments).map(([value, label]) => ({
            value,
            label: label({}, { locale }),
          }))}
          placeholder={m.emailsEditorBlockImageAlignPlaceholder({}, { locale })}
          value={component.align}
        />
        <EmailBlockNumberSetting
          fieldId={setting("width")}
          hint={m.emailsEditorBlockImageWidthHint({}, { locale })}
          label={m.emailsEditorBlockImageWidth({}, { locale })}
          min={1}
          onChange={(width) =>
            update(withEmailSetting(component, "width", width))
          }
          value={component.width}
        />
      </div>
      <EmailBlockTextSetting
        fieldId={setting("href")}
        label={m.emailsEditorBlockImageHref({}, { locale })}
        onChange={(href) => update(withEmailSetting(component, "href", href))}
        placeholder="https://"
        type="url"
        value={component.href}
      />
      <div className="space-y-1">
        <EmailBlockLabelText
          contentLocale={contentLocale}
          label={m.emailsEditorBlockImageAlt({}, { locale })}
          textKey={component.altKey}
        />
        <p className="text-navy-blue/60 text-xs">
          {m.emailsEditorBlockImageAltHint({}, { locale })}
        </p>
      </div>
    </div>
  );
}
