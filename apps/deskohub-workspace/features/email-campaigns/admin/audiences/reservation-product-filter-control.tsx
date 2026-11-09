"use client";

import type {
  ReservationProductFilterType,
  ReservationProductPropertyCondition,
} from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import { ChevronDown, Plus, X } from "lucide-react";
import { useId } from "react";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import {
  type ReservationProductProperty,
  reservationProductFamilies,
  reservationProductProperty,
} from "@/features/reservation/reservation-product-descriptor";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  ConditionLine,
  ConditionText,
  type ControlProps,
  CountComparisonControl,
  compactSelectClassName,
  countComparisonError,
  FieldError,
  SetOperatorSelect,
  ValueChips,
  withPath,
} from "./audience-control-primitives";
import { toggleSetValue } from "./audience-filter-editing";
import {
  reservationProductFamilyLabel,
  reservationProductPropertyLabel,
} from "./reservation-product-wording";

const anyProduct = "any";

/**
 * A number property's comparison. Only a condition of another kind, which
 * the schema rejects anyway, lacks one; it starts over from "≥ blank".
 */
const countComparison = (condition: ReservationProductPropertyCondition) =>
  Match.value(condition).pipe(
    Match.when(
      { operator: Match.is("eq", "ne", "lt", "lte", "gt", "gte") },
      ({ operator, value }) => ({ operator, value })
    ),
    Match.when({ operator: Match.is("anyOf", "noneOf", "is") }, () => ({
      operator: "gte" as const,
      value: Number.NaN,
    })),
    Match.exhaustive
  );

const isReservationFamily = (
  value: string
): value is WorkspaceReservationKind =>
  Object.hasOwn(reservationProductFamilies, value);

/** What a property condition starts as when the operator adds it. */
const newPropertyCondition = (
  property: ReservationProductProperty
): ReservationProductPropertyCondition =>
  Match.value(property).pipe(
    Match.discriminatorsExhaustive("kind")({
      enum: ({ id }) => ({
        property: id,
        operator: "anyOf" as const,
        value: [],
      }),
      boolean: ({ id }) => ({
        property: id,
        operator: "is" as const,
        value: true,
      }),
      number: ({ id }) => ({
        property: id,
        operator: "gte" as const,
        value: 1,
      }),
    })
  );

/**
 * Narrows a reservation-based condition to one product family and, within
 * it, to catalog property conditions. The families, properties, and values
 * all come from the reservation product descriptor.
 */
export function ProductFilterControl({
  value,
  onChange,
  errorAt,
}: ControlProps<ReservationProductFilterType | undefined>) {
  const locale = useRouteLocale();
  const errorIdPrefix = useId();
  const family = value && reservationProductFamilies[value.family];
  const propertyLabel = (property: string) =>
    value
      ? reservationProductPropertyLabel(value.family, property, locale)
      : property;
  const unused =
    family?.properties.filter(
      ({ id }) => !value?.properties.some(({ property }) => property === id)
    ) ?? [];
  const setProperties = (
    properties: readonly ReservationProductPropertyCondition[]
  ) => value && onChange({ ...value, properties });

  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>
          {m.emailCampaignsAudienceProductLabel({}, { locale })}
        </ConditionText>
        <Select
          value={value?.family ?? anyProduct}
          onValueChange={(next) =>
            onChange(
              isReservationFamily(next)
                ? { family: next, properties: [] }
                : undefined
            )
          }
        >
          <SelectTrigger
            aria-label={m.emailCampaignsAudienceProductSelectLabel(
              {},
              { locale }
            )}
            className={compactSelectClassName}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={anyProduct}>
              {m.emailCampaignsAudienceProductAny({}, { locale })}
            </SelectItem>
            {Object.values(reservationProductFamilies).map(({ id }) => (
              <SelectItem key={id} value={id}>
                {reservationProductFamilyLabel(id, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value && unused.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                <Plus className="h-4 w-4" aria-hidden />
                {m.emailCampaignsAudienceProductAddCondition({}, { locale })}
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {unused.map((property) => (
                <DropdownMenuItem
                  key={property.id}
                  onSelect={() =>
                    setProperties([
                      ...value.properties,
                      newPropertyCondition(property),
                    ])
                  }
                >
                  {propertyLabel(property.id)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </ConditionLine>
      {value?.properties.map((condition, index) => {
        const property = reservationProductProperty(
          value.family,
          condition.property
        );
        const conditionErrorAt = withPath(errorAt, `properties.${index}`);
        const conditionErrorId = `${errorIdPrefix}-${condition.property}`;
        const replace = (next: ReservationProductPropertyCondition) =>
          setProperties(
            value.properties.map((current, i) => (i === index ? next : current))
          );
        return (
          <div
            key={condition.property}
            className="ml-3 flex flex-wrap items-center gap-x-2 gap-y-2 border-navy-blue/15 border-l-2 pl-3"
          >
            <ConditionText>{propertyLabel(condition.property)}</ConditionText>
            {property && (
              <ProductPropertyControl
                property={property}
                label={propertyLabel(property.id)}
                value={condition}
                onChange={replace}
                errorAt={conditionErrorAt}
                errorId={conditionErrorId}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              tone="muted"
              size="icon-sm"
              onClick={() =>
                setProperties(value.properties.filter((_, i) => i !== index))
              }
              aria-label={m.emailCampaignsAudienceProductRemoveCondition(
                { property: propertyLabel(condition.property) },
                { locale }
              )}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
            <FieldError
              id={conditionErrorId}
              messages={[
                property?.kind === "number"
                  ? countComparisonError(
                      conditionErrorAt,
                      countComparison(condition).operator,
                      locale
                    )
                  : (conditionErrorAt("operator") ||
                      conditionErrorAt("value")) &&
                    m.emailCampaignsAudienceProductChooseValueError(
                      {},
                      { locale }
                    ),
              ]}
            />
          </div>
        );
      })}
    </div>
  );
}

function ProductPropertyControl({
  property,
  label,
  value,
  onChange,
  errorAt,
  errorId,
}: ControlProps<ReservationProductPropertyCondition> & {
  /** The id of the `FieldError` that explains this property's errors. */
  readonly errorId: string;
  readonly property: ReservationProductProperty;
  /** The property's Admin UI label ("Seats"). */
  readonly label: string;
}) {
  const locale = useRouteLocale();
  const name = useId();

  return Match.value(property).pipe(
    Match.discriminatorsExhaustive("kind")({
      enum: ({ values }) => {
        const chosen =
          value.operator === "anyOf" || value.operator === "noneOf"
            ? value.value
            : [];
        const operator = value.operator === "noneOf" ? "noneOf" : "anyOf";
        const nameOf = (id: string) => {
          const option = values.find((candidate) => candidate.id === id);
          return option ? option.name(locale) : id;
        };
        return (
          <>
            <SetOperatorSelect
              operators={["anyOf", "noneOf"]}
              value={operator}
              onChange={(next) =>
                onChange({
                  property: property.id,
                  operator: next,
                  value: chosen,
                })
              }
              label={label}
            />
            <ValueChips
              values={chosen}
              labelOf={nameOf}
              onRemove={(id) =>
                onChange({
                  property: property.id,
                  operator,
                  value: toggleSetValue(chosen, id, false),
                })
              }
              removeLabel={(valueLabel) =>
                m.emailCampaignsAudienceProductRemoveValue(
                  {
                    property: label.toLocaleLowerCase(locale),
                    value: valueLabel,
                  },
                  { locale }
                )
              }
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  tone={
                    errorAt("value") !== undefined
                      ? "burned-orange"
                      : "navy-blue"
                  }
                  size="sm"
                  aria-invalid={errorAt("value") !== undefined}
                  aria-describedby={
                    errorAt("value") === undefined ? undefined : errorId
                  }
                >
                  {m.emailCampaignsAudienceProductChoose({}, { locale })}
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {values.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.id}
                    checked={chosen.includes(option.id)}
                    onCheckedChange={(checked) =>
                      onChange({
                        property: property.id,
                        operator,
                        value: toggleSetValue(chosen, option.id, checked),
                      })
                    }
                    onSelect={(event) => event.preventDefault()}
                  >
                    {option.name(locale)}
                    {option.retired && (
                      <span className="text-navy-blue/55">
                        {m.emailCampaignsAudienceProductRetired({}, { locale })}
                      </span>
                    )}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        );
      },
      boolean: () => (
        <SegmentedControl
          label={label}
          name={name}
          onValueChange={(next) =>
            onChange({
              property: property.id,
              operator: "is",
              value: next === "with",
            })
          }
          options={[
            {
              label: m.emailCampaignsAudienceProductWith({}, { locale }),
              value: "with",
            },
            {
              label: m.emailCampaignsAudienceProductWithout({}, { locale }),
              value: "without",
            },
          ]}
          size="sm"
          value={value.operator === "is" && !value.value ? "without" : "with"}
        />
      ),
      number: () => (
        <CountComparisonControl
          {...countComparison(value)}
          onChange={(comparison) =>
            onChange({ property: property.id, ...comparison })
          }
          errorAt={errorAt}
          errorId={errorId}
          label={label}
        />
      ),
    })
  );
}
