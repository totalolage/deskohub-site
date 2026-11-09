"use client";

import {
  type EmailDraft,
  referencedEmailValueNames,
} from "@deskohub/workspace-admin-api";
import { Plus } from "lucide-react";
import { useRef } from "react";
import { flushSync } from "react-dom";
import { useFieldArray, useWatch } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  type EmailDraftValueDefinition,
  useEmailDraftForm,
} from "./email-draft-form";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import { EmailValueCustomerPicker } from "./email-value-customer-picker";
import { EmailValueDefinition } from "./email-value-definition";
import { suggestedEmailValueName } from "./email-value-names";
import type { EmailCustomerFieldPath } from "./email-value-options";

/** A discount an email value can issue codes from. */
export type EmailEditorDiscount = {
  readonly id: string;
  /** The discount's name, as the administrator knows it. */
  readonly label: string;
};

/**
 * The email's named value definitions, edited once for every language. Their
 * order is the order publication generates them in.
 */
export function EmailValuesSection({
  discounts,
}: {
  readonly discounts: readonly EmailEditorDiscount[];
}) {
  const locale = useRouteLocale();
  const { control, getValues } = useEmailDraftForm();
  const { fields, append, move, remove } = useFieldArray({
    control,
    name: "values",
  });
  const [structure, translations] = useWatch({
    control,
    name: ["structure", "translations"],
  });
  // The draft's encoded form is its decoded form: it has no transformations.
  const referenced = referencedEmailValueNames({
    structure,
    translations,
  } as EmailDraft);
  const addCustomerRef = useRef<HTMLButtonElement>(null);
  const takenNames = () => (getValues("values") ?? []).map(({ name }) => name);

  const add = (definition: EmailDraftValueDefinition) => {
    const index = fields.length;
    flushSync(() => append(definition, { shouldFocus: false }));
    document
      .getElementById(emailEditorFieldIds.valueSetting(index, "name"))
      ?.focus();
  };
  const addCustomer = (path: EmailCustomerFieldPath) =>
    add({
      name: suggestedEmailValueName(path, takenNames()),
      source: { kind: "customer", path: [...path] },
    });
  const addDiscount = () =>
    add({
      name: suggestedEmailValueName("discount", takenNames()),
      source: { kind: "discount", maxUses: 1, maxUsesPerCustomer: 1 },
    });
  const deleteAt = (index: number) => {
    flushSync(() => remove(index));
    const next =
      document.getElementById(emailEditorFieldIds.value(index)) ??
      document.getElementById(emailEditorFieldIds.value(index - 1));
    (next ?? addCustomerRef.current)?.focus();
  };

  return (
    <section
      aria-labelledby="email-editor-values-heading"
      className="space-y-4"
    >
      <div className="space-y-1">
        <h2
          id="email-editor-values-heading"
          className="font-semibold text-navy-blue/65 text-xs uppercase tracking-[0.1em]"
        >
          {m.emailsEditorValuesHeading({}, { locale })}
        </h2>
        <p className="max-w-2xl text-navy-blue/70 text-sm">
          {m.emailsEditorValuesIntro({}, { locale })}
        </p>
      </div>
      {fields.length === 0 && (
        <p className="rounded-xl border border-navy-blue/15 border-dashed px-4 py-5 text-navy-blue/65 text-sm">
          {m.emailsEditorValuesEmpty({}, { locale })}
        </p>
      )}
      {fields.length > 0 && (
        <ol className="space-y-3">
          {fields.map((field, index) => (
            <EmailValueDefinition
              key={field.id}
              count={fields.length}
              discounts={discounts}
              index={index}
              referencedNames={referenced}
              onMove={(to) => move(index, to)}
              onDelete={() => deleteAt(index)}
            />
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-2">
        <EmailValueCustomerPicker
          restoresFocusOnSelect={false}
          onSelect={addCustomer}
          trigger={() => (
            <Button
              ref={addCustomerRef}
              type="button"
              variant="secondary"
              size="sm"
            >
              <Plus className="size-4" aria-hidden />
              {m.emailsEditorValuesAddCustomer({}, { locale })}
            </Button>
          )}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={addDiscount}
        >
          <Plus className="size-4" aria-hidden />
          {m.emailsEditorValuesAddDiscount({}, { locale })}
        </Button>
      </div>
    </section>
  );
}
