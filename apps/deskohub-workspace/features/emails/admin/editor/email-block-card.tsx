"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { ComponentType } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { EmailBlockButtonSettings } from "./email-block-button";
import { useEmailBlock } from "./email-block-controls";
import { EmailBlockImageSettings } from "./email-block-image";
import { EmailBlockRichTextSettings } from "./email-block-rich-text";
import { EmailBlockTextListSettings } from "./email-block-text-list";
import { EmailBlockValueSettings } from "./email-block-value-settings";
import type {
  EmailDraftComponent,
  EmailDraftComponentTag,
} from "./email-draft-form";
import {
  EmailFieldProblems,
  useEmailFieldProblems,
} from "./email-editor-context";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import {
  type EmailBlockChoice,
  emailBlockChoice,
} from "./email-structure-blocks";

/** Each block kind's name, as the add menu and block headings show it. */
export const emailBlockKindLabels = {
  Paragraph: m.emailsEditorBlockParagraph,
  Heading: m.emailsEditorBlockHeading,
  BulletedList: m.emailsEditorBlockBulletedList,
  NumberedList: m.emailsEditorBlockNumberedList,
  Divider: m.emailsEditorBlockDivider,
  Spacer: m.emailsEditorBlockSpacer,
  Image: m.emailsEditorBlockImage,
  Button: m.emailsEditorBlockButton,
  Record: m.emailsEditorBlockRecord,
  List: m.emailsEditorBlockList,
  Offer: m.emailsEditorBlockOffer,
} as const satisfies Record<
  EmailBlockChoice,
  typeof m.emailsEditorBlockParagraph
>;

/** The id of a block's move or remove button, so focus can return to it. */
export const emailBlockActionId = (
  componentId: string,
  action: "move-up" | "move-down" | "remove"
) => `${emailEditorFieldIds.component(componentId)}-${action}`;

/** What a block without settings of its own shows instead. */
function EmailBlockNoSettings() {
  const locale = useRouteLocale();
  return (
    <p className="text-navy-blue/60 text-sm">
      {m.emailsEditorBlockNoSettings({}, { locale })}
    </p>
  );
}

/** The settings and texts one block kind has. */
function EmailBlockBody({
  component,
  contentLocale,
  index,
}: {
  readonly component: EmailDraftComponent;
  readonly contentLocale: Locale;
  readonly index: number;
}) {
  const Settings = (
    {
      Paragraph: EmailBlockRichTextSettings,
      Heading: EmailBlockRichTextSettings,
      TextList: EmailBlockTextListSettings,
      Image: EmailBlockImageSettings,
      Button: EmailBlockButtonSettings,
      Record: EmailBlockValueSettings,
      List: EmailBlockValueSettings,
      Offer: EmailBlockValueSettings,
      Divider: EmailBlockNoSettings,
      Spacer: EmailBlockNoSettings,
    } as const satisfies Record<
      EmailDraftComponentTag,
      ComponentType<{ readonly contentLocale: Locale; readonly index: number }>
    >
  )[component._tag];
  return <Settings contentLocale={contentLocale} index={index} />;
}

/**
 * One block of the body: its kind and number, buttons that move or remove
 * it, its shared settings, and its texts in `contentLocale`. The card is the
 * focus target of the block's problems that name no narrower field.
 */
export function EmailBlockCard({
  contentLocale,
  count,
  index,
  onMove,
  onRemove,
}: {
  readonly contentLocale: Locale;
  /** How many blocks the body has. */
  readonly count: number;
  readonly index: number;
  readonly onMove: (index: number, offset: -1 | 1) => void;
  readonly onRemove: (index: number) => void;
}) {
  const locale = useRouteLocale();
  const [component] = useEmailBlock(index);
  const componentId = component?.id ?? "";
  const fieldId = emailEditorFieldIds.component(componentId);
  const { controlProps } = useEmailFieldProblems(fieldId);
  if (!component) return null;
  const number = index + 1;
  const kind = emailBlockKindLabels[emailBlockChoice(component)](
    {},
    { locale }
  );
  const headingId = `${fieldId}-heading`;
  const actions = [
    {
      action: "move-up",
      Icon: ArrowUp,
      label: m.emailsEditorBlockMoveUp,
      disabled: index === 0,
      run: () => onMove(index, -1),
    },
    {
      action: "move-down",
      Icon: ArrowDown,
      label: m.emailsEditorBlockMoveDown,
      disabled: index === count - 1,
      run: () => onMove(index, 1),
    },
    {
      action: "remove",
      Icon: Trash2,
      label: m.emailsEditorBlockRemove,
      disabled: false,
      run: () => onRemove(index),
    },
  ] as const;

  return (
    <li>
      {/* biome-ignore lint/a11y/useSemanticElements: the card's header and buttons don't fit a legend; the group only names the block's focus target. */}
      <div
        {...controlProps}
        aria-labelledby={headingId}
        className="rounded-xl border border-navy-blue/12 bg-white shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
        id={fieldId}
        role="group"
        tabIndex={-1}
      >
        <header className="flex items-center gap-3 border-navy-blue/8 border-b px-4 py-2.5">
          <h3
            className="min-w-0 flex-1 truncate font-semibold text-navy-blue text-sm"
            id={headingId}
          >
            {m.emailsEditorBlockTitle({ kind, number }, { locale })}
          </h3>
          <div className="flex shrink-0 items-center gap-1">
            {actions.map(({ action, Icon, label, disabled, run }) => {
              const name = label({ number, kind }, { locale });
              return (
                <Button
                  aria-label={name}
                  disabled={disabled}
                  id={emailBlockActionId(componentId, action)}
                  key={action}
                  onClick={run}
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
        </header>
        <div className="@container space-y-4 px-4 py-4">
          <EmailFieldProblems fieldId={fieldId} />
          <EmailBlockBody
            component={component}
            contentLocale={contentLocale}
            index={index}
          />
        </div>
      </div>
    </li>
  );
}
