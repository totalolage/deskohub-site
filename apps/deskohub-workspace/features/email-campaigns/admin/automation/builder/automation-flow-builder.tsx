"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import type {
  AdministrationCampaignDetail,
  AutomationDetailType as AutomationDetail,
} from "@deskohub/workspace-admin-api";
import Interpolate from "@doist/react-interpolate";
import { useRouter } from "next/navigation";
import { Fragment, useRef, useState } from "react";
import { get, useController, useForm } from "react-hook-form";
import { AdministrationLink } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import type { CampaignOperationFailureCopy } from "../../campaign-operation-failure";
import { useCampaignOperation } from "../../use-campaign-operation";
import {
  canMoveStep,
  insertStepAt,
  moveStep,
  newStep,
  removeStepAt,
  replaceStepAt,
  triggerPreviewKey,
} from "./automation-flow-editing";
import {
  type AutomationFlowFormOutput,
  type AutomationFlowFormValues,
  automationFlowFormValues,
  createAutomationFlowFormSchema,
  type FlowStepValue,
} from "./automation-flow-form";
import type { AutomationFlowBuilderData } from "./automation-flow-page-data.server";
import {
  scheduleMinutesNotAllowedCode,
  scheduleMinutesNotAllowedCopy,
} from "./calendar-preview";
import { FlowConnector, InsertStepMenu, StepMenu } from "./flow-step-frame";
import {
  ConditionStepCard,
  SendStepCard,
  stepLabel,
  WaitStepCard,
} from "./step-cards";
import { TriggerCard } from "./trigger-card";

const saveFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) => m.emailAutomationFlowSaveFailed({}, { locale }),
  codes: {
    "flow-invalid": (locale) =>
      m.emailAutomationFlowSaveInvalid({}, { locale }),
    "calendar-never-occurs": (locale) =>
      m.emailAutomationFlowCalendarNeverOccurs({}, { locale }),
    [scheduleMinutesNotAllowedCode]: scheduleMinutesNotAllowedCopy,
    "automation-archived": (locale) =>
      m.emailAutomationFlowArchived({}, { locale }),
    "audience-filter-context": (locale) =>
      m.emailAutomationFlowSaveInvalid({}, { locale }),
  },
};

type SaveFailure = { readonly message: string; readonly code?: string };

/**
 * The automation's flow as vertical cards (D19): the trigger, then each
 * step, with "+" insert points on the connectors and the send step last.
 * It edits the working copy only; previews and activation publish it.
 */
export function AutomationFlowBuilder({
  campaign,
  automation,
  data,
}: {
  readonly campaign: AdministrationCampaignDetail;
  readonly automation: AutomationDetail;
  readonly data: AutomationFlowBuilderData;
}) {
  const locale = useRouteLocale();
  const router = useRouter();
  const readOnly = automation.status === "archived";
  // Discarding restarts every card, so calendar previews return to the saved flow's.
  const [revision, setRevision] = useState(0);
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);
  const form = useForm<
    AutomationFlowFormValues,
    unknown,
    AutomationFlowFormOutput
  >({
    defaultValues: automationFlowFormValues(automation.flow),
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(createAutomationFlowFormSchema(locale), {
      onExcessProperty: "error",
    }),
  });
  const { field: triggerField } = useController({
    control: form.control,
    name: "trigger",
  });
  const { field: stepsField } = useController({
    control: form.control,
    name: "steps",
  });
  const trigger = triggerField.value;
  const steps = stepsField.value;
  const setSteps = (next: readonly FlowStepValue[]) =>
    stepsField.onChange(next);

  const save = useCampaignOperation("updateAutomationFlow", {
    failureCopy: saveFailureCopy,
    onSuccess: (saved) => {
      form.reset(automationFlowFormValues(saved.flow));
      router.refresh();
    },
    onFailure: (message, failure) =>
      setSaveFailure({ message, code: failure?.code }),
  });

  const errorAt = (path: string): string | undefined =>
    get(form.formState.errors, path)?.message;
  const minutesError =
    saveFailure?.code === scheduleMinutesNotAllowedCode
      ? saveFailure.message
      : undefined;
  const toolbarError =
    saveFailure && saveFailure.code !== scheduleMinutesNotAllowedCode
      ? saveFailure.message
      : undefined;

  // Each step's insert point, by step id, to take focus from a deleted step.
  const insertPoints = useRef(new Map<string, HTMLButtonElement>());
  const stepMenu = (index: number, step: FlowStepValue, number: number) => (
    <StepMenu
      stepLabel={stepLabel(step, number, locale)}
      canMoveUp={canMoveStep(steps, index, -1)}
      canMoveDown={canMoveStep(steps, index, 1)}
      onMoveUp={() => setSteps(moveStep(steps, index, -1))}
      onMoveDown={() => setSteps(moveStep(steps, index, 1))}
      onDelete={() => setSteps(removeStepAt(steps, index))}
      // The next step takes the deleted one's place; the send step is last
      // and can't be deleted, so there always is one.
      onDeleted={() => {
        const next = steps[index + 1];
        if (next) insertPoints.current.get(next.id)?.focus();
      }}
    />
  );

  return (
    <form
      noValidate
      className="@container"
      onSubmit={form.handleSubmit(({ trigger: chosen, steps: flowSteps }) => {
        setSaveFailure(null);
        if (chosen === null) return;
        save.execute({
          campaignId: campaign.id,
          flow: { trigger: chosen, steps: flowSteps },
        });
      })}
    >
      <FlowToolbar
        campaignId={campaign.id}
        automation={automation}
        dirty={form.formState.isDirty}
        readOnly={readOnly}
        saving={save.isExecuting}
        error={toolbarError}
        onDiscard={() => {
          form.reset();
          setSaveFailure(null);
          setRevision((current) => current + 1);
        }}
      />
      {/* Locked while saving: the saved flow replaces the form's values. */}
      <fieldset
        disabled={readOnly || save.isExecuting}
        className="mx-auto mt-6 max-w-[44rem] min-w-0"
      >
        <ol key={revision}>
          <li>
            <TriggerCard
              trigger={trigger}
              onChange={(next) => {
                if (saveFailure?.code === scheduleMinutesNotAllowedCode) {
                  setSaveFailure(null);
                }
                triggerField.onChange(next);
              }}
              initialPreview={data.calendarPreviews[triggerPreviewKey]}
              errorAt={(field) =>
                errorAt(field === "" ? "trigger" : `trigger.${field}`)
              }
              minutesError={minutesError}
            />
          </li>
          {steps.map((step, index) => {
            const number = index + 1;
            const path = `steps.${index}`;
            const update = (next: FlowStepValue) =>
              setSteps(replaceStepAt(steps, index, next));
            return (
              <Fragment key={step.id}>
                <li>
                  <FlowConnector>
                    {!readOnly && (
                      <InsertStepMenu
                        triggerRef={(trigger) => {
                          if (!trigger) return;
                          insertPoints.current.set(step.id, trigger);
                          return () => {
                            insertPoints.current.delete(step.id);
                          };
                        }}
                        position={number}
                        onInsert={(kind) =>
                          setSteps(
                            insertStepAt(steps, index, newStep(kind, steps))
                          )
                        }
                      />
                    )}
                  </FlowConnector>
                </li>
                <li>
                  {step._tag === "Condition" && (
                    <ConditionStepCard
                      step={step}
                      number={number}
                      onChange={update}
                      menu={!readOnly && stepMenu(index, step, number)}
                      path={path}
                      errorAt={errorAt}
                      lookups={data.lookups}
                      savedAudiences={data.savedAudiences}
                    />
                  )}
                  {step._tag === "Wait" && (
                    <WaitStepCard
                      step={step}
                      number={number}
                      onChange={update}
                      menu={!readOnly && stepMenu(index, step, number)}
                      errorAt={(field) => errorAt(`${path}.wait.${field}`)}
                      initialPreview={data.calendarPreviews[step.id]}
                    />
                  )}
                  {step._tag === "Send" && (
                    <SendStepCard campaign={campaign} number={number} />
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </fieldset>
    </form>
  );
}

/** Where the working copy stands against the saved and live flows. */
const flowSaveState = ({
  automation,
  dirty,
  readOnly,
}: {
  readonly automation: AutomationDetail;
  readonly dirty: boolean;
  readonly readOnly: boolean;
}) => {
  if (readOnly) return "archived";
  if (dirty) return "unsaved";
  if (automation.flow === null) return "empty";
  return automation.pendingChanges ? "pending" : "published";
};

/**
 * Where the working copy stands, with Discard and Save. Local edits come
 * first, then saved changes not yet published, then a match with the live
 * version.
 */
function FlowToolbar({
  campaignId,
  automation,
  dirty,
  readOnly,
  saving,
  error,
  onDiscard,
}: {
  readonly campaignId: string;
  readonly automation: AutomationDetail;
  readonly dirty: boolean;
  readonly readOnly: boolean;
  readonly saving: boolean;
  readonly error: string | undefined;
  readonly onDiscard: () => void;
}) {
  const locale = useRouteLocale();
  const state = flowSaveState({ automation, dirty, readOnly });

  return (
    <div className="space-y-2 rounded-xl border border-navy-blue/10 bg-white px-4 py-3">
      <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between">
        <p
          aria-live="polite"
          className="flex items-center gap-2 text-navy-blue/70 text-sm"
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              {
                archived: "bg-navy-blue/30",
                unsaved: "bg-burned-orange",
                empty: "bg-navy-blue/30",
                pending: "bg-sunset-yellow",
                published: "bg-emerald-600",
              }[state]
            )}
          />
          <span>
            {{
              archived: () =>
                m.emailAutomationFlowStatusArchived({}, { locale }),
              unsaved: () => m.emailAutomationFlowStatusUnsaved({}, { locale }),
              empty: () => m.emailAutomationFlowStatusEmpty({}, { locale }),
              pending: () => (
                <Interpolate
                  string={m.emailAutomationFlowStatusPending({}, { locale })}
                  mapping={{
                    link: (
                      <AdministrationLink
                        href={administrationHref(
                          "/[locale]/admin/email-campaigns/[campaignId]/preview",
                          { campaignId }
                        )}
                        className="font-semibold text-burned-orange underline-offset-4 hover:underline"
                      />
                    ),
                  }}
                />
              ),
              published: () =>
                m.emailAutomationFlowStatusPublished({}, { locale }),
            }[state]()}
          </span>
        </p>
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              tone="muted"
              size="sm"
              disabled={!dirty || saving}
              onClick={onDiscard}
            >
              {m.emailAutomationFlowDiscard({}, { locale })}
            </Button>
            <Button type="submit" size="sm" disabled={!dirty || saving}>
              {saving
                ? m.emailAutomationFlowSaving({}, { locale })
                : m.emailAutomationFlowSave({}, { locale })}
            </Button>
          </div>
        )}
      </div>
      <p role="alert" className="text-burned-orange text-sm empty:hidden">
        {error}
      </p>
    </div>
  );
}
