"use client";

import { Record } from "effect";
import { Plus, Trash2 } from "lucide-react";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  EmailBlockTextSetting,
  emailRowRemovalFocus,
  useEmailBlock,
  useEmailFocusAfterChange,
} from "./email-block-controls";
import { newEmailEditorKey } from "./email-draft-form";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import { withEmailSetting } from "./email-structure-blocks";

/**
 * The shared destinations of a text block's links. Every language's texts
 * link to these by key, so a destination is set once. Removing one leaves
 * the texts that used it pointing nowhere, which the problems then show.
 */
export function EmailBlockLinks({ index }: { readonly index: number }) {
  const locale = useRouteLocale();
  const [component, update] = useEmailBlock(index);
  const focusAfterChange = useEmailFocusAfterChange();
  if (!component?.id) return null;
  const componentId = component.id;
  const links = component.links ?? {};
  const removeId = (linkKey: string) =>
    `${emailEditorFieldIds.componentLink(componentId, linkKey)}-remove`;
  const addId = `${emailEditorFieldIds.component(componentId)}-add-link`;
  const setLinks = (next: { readonly [linkKey: string]: string }) =>
    update(
      withEmailSetting(
        component,
        "links",
        Object.keys(next).length > 0 ? next : undefined
      )
    );

  return (
    <fieldset className="space-y-2 rounded-lg border border-navy-blue/12 bg-navy-blue/[0.02] p-3">
      <legend className="px-1 font-semibold text-navy-blue text-xs">
        {m.emailsEditorBlockLinksHeading({}, { locale })}
      </legend>
      <p className="text-navy-blue/60 text-xs">
        {m.emailsEditorBlockLinksNote({}, { locale })}
      </p>
      {Object.entries(links).map(([linkKey, href], position) => {
        const number = position + 1;
        return (
          <div className="flex items-end gap-2" key={linkKey}>
            <div className="min-w-0 flex-1">
              <EmailBlockTextSetting
                fieldId={emailEditorFieldIds.componentLink(
                  componentId,
                  linkKey
                )}
                label={m.emailsEditorBlockLinkLabel({ number }, { locale })}
                onChange={(value) =>
                  setLinks({ ...links, [linkKey]: value ?? "" })
                }
                placeholder="https://"
                type="url"
                value={href}
              />
            </div>
            <Button
              aria-label={m.emailsEditorBlockLinkRemove({ number }, { locale })}
              id={removeId(linkKey)}
              onClick={() => {
                const remaining = Record.remove(links, linkKey);
                setLinks(remaining);
                focusAfterChange(
                  emailRowRemovalFocus(
                    Object.keys(remaining).map(removeId),
                    position,
                    addId
                  )
                );
              }}
              size="icon-sm"
              title={m.emailsEditorBlockLinkRemove({ number }, { locale })}
              tone="muted"
              type="button"
              variant="ghost"
            >
              <Trash2 aria-hidden className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      <Button
        id={addId}
        onClick={() => setLinks({ ...links, [newEmailEditorKey("link")]: "" })}
        size="sm"
        type="button"
        variant="secondary"
      >
        <Plus aria-hidden className="h-4 w-4" />
        {m.emailsEditorBlockLinkAdd({}, { locale })}
      </Button>
    </fieldset>
  );
}
