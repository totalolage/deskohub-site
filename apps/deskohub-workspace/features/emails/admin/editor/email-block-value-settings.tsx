"use client";

import { isEmailCustomerScalar } from "@deskohub/workspace-admin-api";
import { Plus, Trash2 } from "lucide-react";
import { useWatch } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  EmailBlockLabelText,
  EmailBlockNumberSetting,
  type EmailBlockOption,
  EmailBlockSelectSetting,
  EmailBlockTextSetting,
  emailRowRemovalFocus,
  useEmailBlock,
  useEmailFocusAfterChange,
  useRemoveEmailTexts,
} from "./email-block-controls";
import {
  type EmailDraftComponent,
  type EmailDraftValueDefinition,
  newEmailEditorKey,
  useEmailDraftForm,
} from "./email-draft-form";
import {
  EmailFieldProblems,
  useEmailFieldProblems,
} from "./email-editor-context";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import { emailKeyOccurrence, withEmailSetting } from "./email-structure-blocks";
import {
  type EmailCustomerFieldPath,
  type EmailValueKind,
  emailCustomerFieldPathLabel,
  emailValueKind,
  selectedEmailCustomerField,
  selectedEmailCustomerFieldPaths,
} from "./email-value-options";

type ValueBlockTag = "Record" | "List" | "Offer";

/** The value kind each value block shows, and the note when there's none. */
const valueBlocks = {
  Record: { kind: "record", none: m.emailsEditorBlockValueNoneRecord },
  List: { kind: "list", none: m.emailsEditorBlockValueNoneList },
  Offer: { kind: "discount", none: m.emailsEditorBlockValueNoneDiscount },
} as const satisfies Record<
  ValueBlockTag,
  {
    readonly kind: EmailValueKind;
    readonly none: typeof m.emailsEditorBlockValueNoneRecord;
  }
>;

/** A path as a select value; paths may hold any character. */
const pathValue = (path: EmailCustomerFieldPath): string =>
  JSON.stringify(path);

/** `options`, plus `current` marked unavailable when no option is it, so a broken choice stays visible. */
const withCurrent = (
  options: readonly EmailBlockOption[],
  current: string | undefined,
  label: string,
  locale: Locale
): readonly EmailBlockOption[] =>
  current === undefined || options.some((option) => option.value === current)
    ? options
    : [
        ...options,
        {
          value: current,
          label: m.emailsEditorBlockValueUnavailable(
            { name: label },
            { locale }
          ),
        },
      ];

const sortNone = "none";

type ComponentField = NonNullable<EmailDraftComponent["fields"]>[number];

/** The fields a record or list block shows, each with its label in `contentLocale`. */
function ValueBlockFields({
  component,
  contentLocale,
  definition,
  update,
}: {
  readonly component: EmailDraftComponent & { readonly id: string };
  readonly contentLocale: Locale;
  readonly definition: EmailDraftValueDefinition | undefined;
  readonly update: (next: EmailDraftComponent) => void;
}) {
  const locale = useRouteLocale();
  const removeTexts = useRemoveEmailTexts();
  const focusAfterChange = useEmailFocusAfterChange();
  const fieldsId = emailEditorFieldIds.componentSetting(component.id, "fields");
  const { controlProps } = useEmailFieldProblems(fieldsId);
  const fields = component.fields ?? [];
  const paths = definition ? selectedEmailCustomerFieldPaths(definition) : [];
  // Label keys may repeat, so a row is named by its key's occurrence.
  const rowIds = (rows: readonly ComponentField[]) =>
    rows.map(
      (_row, position) =>
        `${fieldsId}-${emailKeyOccurrence(
          rows.map((row) => row.labelKey),
          position
        )}`
    );
  const ids = rowIds(fields);
  const addId = `${fieldsId}-add`;
  const setFields = (next: readonly ComponentField[]) =>
    update(
      withEmailSetting(component, "fields", next.length > 0 ? next : undefined)
    );

  return (
    <fieldset
      {...controlProps}
      className="space-y-3 rounded-lg border border-navy-blue/12 bg-navy-blue/[0.02] p-3 outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
      id={fieldsId}
      tabIndex={-1}
    >
      <legend className="px-1 font-semibold text-navy-blue text-xs">
        {m.emailsEditorBlockFields({}, { locale })}
      </legend>
      <EmailFieldProblems fieldId={fieldsId} />
      {fields.map((field, position) => {
        const number = position + 1;
        const current = field.field?.length ? field.field : undefined;
        const setField = (next: ComponentField) =>
          setFields(
            fields.map((entry, at) => (at === position ? next : entry))
          );
        return (
          <div
            className="flex flex-wrap items-end gap-3"
            key={ids[position] ?? ""}
          >
            <EmailBlockSelectSetting
              fieldId={ids[position] ?? ""}
              label={m.emailsEditorBlockField({ number }, { locale })}
              onChange={(value) => {
                const path = paths.find(
                  (option) => pathValue(option) === value
                );
                if (path) setField({ ...field, field: path });
              }}
              options={withCurrent(
                paths.map((path) => ({
                  value: pathValue(path),
                  label: emailCustomerFieldPathLabel(path),
                })),
                current && pathValue(current),
                current ? emailCustomerFieldPathLabel(current) : "",
                locale
              )}
              placeholder={m.emailsEditorBlockFieldPlaceholder({}, { locale })}
              value={current && pathValue(current)}
            />
            <div className="min-w-48 flex-1">
              <EmailBlockLabelText
                contentLocale={contentLocale}
                label={m.emailsEditorBlockFieldLabel({ number }, { locale })}
                textKey={field.labelKey}
              />
            </div>
            <Button
              aria-label={m.emailsEditorBlockFieldRemove(
                { number },
                { locale }
              )}
              id={`${ids[position] ?? ""}-remove`}
              onClick={() => {
                const remaining = fields.filter(
                  (_entry, at) => at !== position
                );
                setFields(remaining);
                if (field.labelKey) removeTexts([field.labelKey]);
                focusAfterChange(
                  emailRowRemovalFocus(
                    rowIds(remaining).map((id) => `${id}-remove`),
                    position,
                    addId
                  )
                );
              }}
              size="icon-sm"
              title={m.emailsEditorBlockFieldRemove({ number }, { locale })}
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
        onClick={() =>
          setFields([...fields, { labelKey: newEmailEditorKey("text") }])
        }
        size="sm"
        type="button"
        variant="secondary"
      >
        <Plus aria-hidden className="h-4 w-4" />
        {m.emailsEditorBlockFieldAdd({}, { locale })}
      </Button>
    </fieldset>
  );
}

/** A list block's sorting and limit. */
function ListBlockOrder({
  component,
  definition,
  update,
}: {
  readonly component: EmailDraftComponent & { readonly id: string };
  readonly definition: EmailDraftValueDefinition | undefined;
  readonly update: (next: EmailDraftComponent) => void;
}) {
  const locale = useRouteLocale();
  const sortId = emailEditorFieldIds.componentSetting(component.id, "sort");
  const selected = definition && selectedEmailCustomerField(definition);
  const element = selected?.kind === "list" ? selected.element : undefined;
  // A list of scalars sorts by its items themselves, the empty path.
  const scalarItems = element !== undefined && isEmailCustomerScalar(element);
  const recordPaths = definition
    ? selectedEmailCustomerFieldPaths(definition)
    : [];
  const paths: readonly EmailCustomerFieldPath[] = scalarItems
    ? [[]]
    : recordPaths;
  const sort = component.sort;
  const current = sort?.path;
  const pathLabel = (path: EmailCustomerFieldPath) =>
    path.length === 0
      ? m.emailsEditorBlockSortItself({}, { locale })
      : emailCustomerFieldPathLabel(path);

  return (
    <div className="flex flex-wrap items-start gap-4">
      <EmailBlockSelectSetting
        fieldId={sortId}
        label={m.emailsEditorBlockSort({}, { locale })}
        onChange={(value) => {
          if (value === sortNone)
            return update(withEmailSetting(component, "sort", undefined));
          const path = paths.find((option) => pathValue(option) === value);
          if (path)
            update({
              ...component,
              sort: { path, direction: sort?.direction ?? "asc" },
            });
        }}
        options={withCurrent(
          [
            {
              value: sortNone,
              label: m.emailsEditorBlockSortNone({}, { locale }),
            },
            ...paths.map((path) => ({
              value: pathValue(path),
              label: pathLabel(path),
            })),
          ],
          current && pathValue(current),
          current ? pathLabel(current) : "",
          locale
        )}
        placeholder={m.emailsEditorBlockSortNone({}, { locale })}
        value={sort === undefined ? sortNone : current && pathValue(current)}
      />
      {sort && (
        <EmailBlockSelectSetting
          fieldId={`${sortId}-direction`}
          label={m.emailsEditorBlockSortDirection({}, { locale })}
          onChange={(direction) => {
            if (direction === "asc" || direction === "desc")
              update({ ...component, sort: { ...sort, direction } });
          }}
          options={[
            {
              value: "asc",
              label: m.emailsEditorBlockSortAscending({}, { locale }),
            },
            {
              value: "desc",
              label: m.emailsEditorBlockSortDescending({}, { locale }),
            },
          ]}
          placeholder={m.emailsEditorBlockSortDirectionPlaceholder(
            {},
            { locale }
          )}
          value={sort.direction}
        />
      )}
      <EmailBlockNumberSetting
        fieldId={emailEditorFieldIds.componentSetting(component.id, "limit")}
        hint={m.emailsEditorBlockLimitHint({}, { locale })}
        label={m.emailsEditorBlockLimit({}, { locale })}
        min={1}
        onChange={(limit) =>
          update(withEmailSetting(component, "limit", limit))
        }
        value={component.limit}
      />
    </div>
  );
}

/**
 * The settings of a block that shows a named value: a record's fields, a
 * list's fields, sorting and limit, or an offer's destination and label.
 * The value choice lists only values of the kind the block shows.
 */
export function EmailBlockValueSettings({
  contentLocale,
  index,
}: {
  readonly contentLocale: Locale;
  readonly index: number;
}) {
  const locale = useRouteLocale();
  const { control } = useEmailDraftForm();
  const definitions = useWatch({ control, name: "values" }) ?? [];
  const [component, update] = useEmailBlock(index);
  if (!component?.id) return null;
  if (
    component._tag !== "Record" &&
    component._tag !== "List" &&
    component._tag !== "Offer"
  )
    return null;
  const block = { ...component, id: component.id };
  const { kind, none } = valueBlocks[component._tag];
  const names = [
    ...new Set(
      definitions.flatMap((definition) =>
        definition.name && emailValueKind(definition) === kind
          ? [definition.name]
          : []
      )
    ),
  ];
  const definition = definitions.find(
    (candidate) =>
      candidate.name !== undefined && candidate.name === component.value
  );
  const selected = definition && selectedEmailCustomerField(definition);
  const recordElement =
    selected?.kind === "list" && selected.element.kind === "record";
  const showFields =
    component._tag === "Record" ||
    (component._tag === "List" &&
      (recordElement || (component.fields ?? []).length > 0));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <EmailBlockSelectSetting
          fieldId={emailEditorFieldIds.componentSetting(block.id, "value")}
          label={m.emailsEditorBlockValue({}, { locale })}
          onChange={(value) => update({ ...component, value })}
          options={withCurrent(
            names.map((name) => ({ value: name, label: name })),
            component.value,
            component.value ?? "",
            locale
          )}
          placeholder={m.emailsEditorBlockValuePlaceholder({}, { locale })}
          value={component.value}
        />
        {names.length === 0 && (
          <p className="text-navy-blue/60 text-xs">{none({}, { locale })}</p>
        )}
      </div>
      {showFields && (
        <ValueBlockFields
          component={block}
          contentLocale={contentLocale}
          definition={definition}
          update={update}
        />
      )}
      {component._tag === "List" && (
        <ListBlockOrder
          component={block}
          definition={definition}
          update={update}
        />
      )}
      {component._tag === "Offer" && (
        <>
          <EmailBlockTextSetting
            fieldId={emailEditorFieldIds.componentSetting(block.id, "href")}
            label={m.emailsEditorBlockHref({}, { locale })}
            onChange={(href) =>
              update(withEmailSetting(component, "href", href))
            }
            placeholder="https://"
            type="url"
            value={component.href}
          />
          <EmailBlockLabelText
            contentLocale={contentLocale}
            label={m.emailsEditorBlockButtonLabel({}, { locale })}
            textKey={component.labelKey}
          />
        </>
      )}
    </div>
  );
}
