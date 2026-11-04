"use client";

import { isEmailCustomerScalar } from "@deskohub/workspace-admin-api";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import type {
  EmailDraftValueDefinition,
  EmailDraftValueSource,
} from "./email-draft-form";
import {
  EmailFieldProblems,
  useEmailFieldProblems,
} from "./email-editor-context";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import { EmailValueNumberInput } from "./email-value-number-input";
import {
  type EmailCustomerFieldPath,
  emailCustomerFieldPathLabel,
  emailCustomerScalarPaths,
  selectedEmailCustomerField,
  selectedEmailCustomerFieldPaths,
} from "./email-value-options";

const pathKey = (path: EmailCustomerFieldPath) => JSON.stringify(path);
const unsorted = "none";

/**
 * The settings of a customer value past its field: which fields a record or
 * a list of records includes, and how a list is sorted and limited.
 */
export function EmailValueCustomerSource({
  definition,
  index,
  onChange,
}: {
  readonly definition: EmailDraftValueDefinition;
  readonly index: number;
  readonly onChange: (source: EmailDraftValueSource) => void;
}) {
  const locale = useRouteLocale();
  const field = selectedEmailCustomerField(definition);
  const source = definition.source;
  const fieldsId = emailEditorFieldIds.valueSetting(index, "fields");
  const sortId = emailEditorFieldIds.valueSetting(index, "sort");
  const fieldsProblems = useEmailFieldProblems(fieldsId);
  const sortProblems = useEmailFieldProblems(sortId);
  if (!field || !source) return;
  const item = field.kind === "list" ? field.element : field;
  const fieldPaths =
    item.kind === "record" ? emailCustomerScalarPaths(item) : [];
  const chosenPaths = selectedEmailCustomerFieldPaths(definition);
  const chosen = new Set(chosenPaths.map(pathKey));
  const sortPaths = isEmailCustomerScalar(item) ? [[]] : chosenPaths;
  const sortPath = source.sort?.path;

  const toggleField = (path: EmailCustomerFieldPath, include: boolean) => {
    const next = new Set(chosen);
    if (include) next.add(pathKey(path));
    else next.delete(pathKey(path));
    const fields = fieldPaths.filter((option) => next.has(pathKey(option)));
    const { fields: _fields, sort, ...rest } = source;
    // A sort by a field the list no longer includes can't apply.
    const keepsSort = sort?.path === undefined || next.has(pathKey(sort.path));
    onChange({
      ...rest,
      ...(fields.length > 0 && { fields: fields.map((path) => [...path]) }),
      ...(sort && keepsSort && { sort }),
    });
  };
  const chooseSortPath = (key: string) => {
    const { sort, ...rest } = source;
    const path = sortPaths.find((option) => pathKey(option) === key);
    onChange(
      path
        ? {
            ...rest,
            sort: { path: [...path], direction: sort?.direction ?? "asc" },
          }
        : rest
    );
  };
  const changeLimit = (limit: number | undefined) => {
    const { limit: _limit, ...rest } = source;
    onChange(limit === undefined ? rest : { ...rest, limit });
  };
  const sortLabel = (path: EmailCustomerFieldPath) =>
    path.length > 0
      ? emailCustomerFieldPathLabel(path)
      : m.emailsEditorValuesSortItem({}, { locale });

  return (
    <>
      {item.kind === "record" && (
        <fieldset
          id={fieldsId}
          tabIndex={-1}
          className="space-y-2 outline-none"
          aria-describedby={fieldsProblems.describedBy}
        >
          <legend className="font-medium text-sm leading-none">
            {m.emailsEditorValuesFieldsLabel({}, { locale })}
          </legend>
          <p className="text-navy-blue/55 text-xs">
            {m.emailsEditorValuesFieldsHint({}, { locale })}
          </p>
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {fieldPaths.map((path, position) => {
              const checkboxId = `${fieldsId}-${position}`;
              return (
                <div key={pathKey(path)} className="flex items-center gap-2">
                  <Checkbox
                    id={checkboxId}
                    className="size-5"
                    checked={chosen.has(pathKey(path))}
                    {...fieldsProblems.controlProps}
                    onCheckedChange={(checked) =>
                      toggleField(path, checked === true)
                    }
                  />
                  <Label
                    htmlFor={checkboxId}
                    className="min-w-0 truncate font-mono font-normal text-[13px]"
                  >
                    {emailCustomerFieldPathLabel(path)}
                  </Label>
                </div>
              );
            })}
          </div>
          <EmailFieldProblems fieldId={fieldsId} />
        </fieldset>
      )}
      {field.kind === "list" && (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor={sortId}>
                  {m.emailsEditorValuesSortLabel({}, { locale })}
                </Label>
                <Select
                  value={sortPath ? pathKey(sortPath) : unsorted}
                  onValueChange={chooseSortPath}
                >
                  <SelectTrigger
                    id={sortId}
                    className="min-h-9 w-auto min-w-44 rounded-md px-3 py-1.5 text-sm"
                    variant={sortProblems.invalid ? "error" : "default"}
                    {...sortProblems.controlProps}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={unsorted}>
                      {m.emailsEditorValuesSortNone({}, { locale })}
                    </SelectItem>
                    {sortPaths.map((path) => (
                      <SelectItem key={pathKey(path)} value={pathKey(path)}>
                        {sortLabel(path)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${sortId}-direction`}>
                  {m.emailsEditorValuesSortDirectionLabel({}, { locale })}
                </Label>
                <Select
                  disabled={!sortPath}
                  value={source.sort?.direction ?? ""}
                  onValueChange={(direction) =>
                    onChange({
                      ...source,
                      sort: {
                        ...source.sort,
                        direction: direction === "desc" ? "desc" : "asc",
                      },
                    })
                  }
                >
                  <SelectTrigger
                    id={`${sortId}-direction`}
                    className="min-h-9 w-auto min-w-36 rounded-md px-3 py-1.5 text-sm"
                    variant={sortProblems.invalid ? "error" : "default"}
                    {...sortProblems.controlProps}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">
                      {m.emailsEditorValuesSortAscending({}, { locale })}
                    </SelectItem>
                    <SelectItem value="desc">
                      {m.emailsEditorValuesSortDescending({}, { locale })}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <EmailFieldProblems fieldId={sortId} />
          </div>
          <EmailValueNumberInput
            id={emailEditorFieldIds.valueSetting(index, "limit")}
            label={m.emailsEditorValuesLimitLabel({}, { locale })}
            hint={m.emailsEditorValuesLimitHint({}, { locale })}
            value={source.limit}
            onChange={changeLimit}
          />
        </div>
      )}
    </>
  );
}
