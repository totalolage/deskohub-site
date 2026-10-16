"use client";

import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import { CtaButtonDialog } from "./cta-button-dialog";

/** The editor's rendering of a CTA button; Edit on the selected button opens it. */
export function CtaButtonNodeView({
  deleteNode,
  editor,
  node,
  selected,
  updateAttributes,
}: ReactNodeViewProps) {
  const locale = useRouteLocale();
  const [editing, setEditing] = useState(false);
  const label = String(node.attrs.label ?? "");
  const href = String(node.attrs.href ?? "");

  return (
    <NodeViewWrapper
      className="my-4 flex flex-col items-center gap-1.5"
      data-cta-button=""
    >
      <div className="relative">
        <span
          className={cn(
            "inline-flex min-h-11 cursor-pointer select-none items-center rounded-md bg-burned-orange px-6 font-semibold text-sm text-white",
            selected && "ring-2 ring-navy-blue ring-offset-2",
            !label && "bg-burned-orange/50 italic"
          )}
          data-drag-handle=""
        >
          {label || m.emailCampaignsCtaLabelMissing({}, { locale })}
        </span>
        {selected && editor.isEditable && (
          <Button
            className="absolute -right-3 -top-3"
            contentEditable={false}
            onClick={() => setEditing(true)}
            size="icon-sm"
            type="button"
            variant="secondary"
          >
            <Pencil aria-hidden className="size-3.5" />
            <span className="sr-only">
              {m.emailCampaignsCtaEdit({}, { locale })}
            </span>
          </Button>
        )}
      </div>
      <span
        className={cn(
          "max-w-full truncate text-xs",
          href ? "text-navy-blue/55" : "text-burned-orange-ink"
        )}
        contentEditable={false}
      >
        {href || m.emailCampaignsCtaHrefMissing({}, { locale })}
      </span>
      <CtaButtonDialog
        initialValues={{ label, href }}
        onOpenChange={setEditing}
        onRemove={() => {
          setEditing(false);
          deleteNode();
        }}
        onSubmit={(values) => updateAttributes(values)}
        open={editing}
      />
    </NodeViewWrapper>
  );
}
