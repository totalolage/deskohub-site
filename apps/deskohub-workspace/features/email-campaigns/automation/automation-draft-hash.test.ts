import { describe, expect, test } from "bun:test";
import {
  type AutomationFlowType as AutomationFlow,
  AutomationStepId,
} from "@deskohub/workspace-admin-api";
import { Predicate } from "effect";
import type { AudienceFilter } from "../audience-filter";
import type {
  CampaignLocalizedContent,
  CampaignTemplateKey,
} from "../body/campaign-content";
import { campaignAudienceIdSchema } from "../campaign-identifiers";
import {
  type AutomationPublishableCopy,
  hashAutomationDraft,
} from "./automation-draft-hash";

const body = (text: string) => ({
  formatVersion: 1 as const,
  doc: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
});

const content: CampaignLocalizedContent = {
  "cs-CZ": { subject: "Vraťte se", preheader: "Sleva", body: body("Ahoj") },
  "en-US": { subject: "Come back", preheader: "Offer", body: body("Hi") },
};

const flow: AutomationFlow = {
  trigger: {
    _tag: "Schedule",
    calendar: { minutes: [0], hours: [9], weekdays: ["monday", "friday"] },
  },
  steps: [
    {
      _tag: "Condition",
      id: AutomationStepId.make("regulars"),
      filter: {
        _tag: "InAudience",
        audienceId: campaignAudienceIdSchema.make("regulars"),
        operator: "in",
      },
    },
    {
      _tag: "Wait",
      id: AutomationStepId.make("wait"),
      wait: { _tag: "Duration", count: 2, unit: "day" },
    },
    { _tag: "Send", id: AutomationStepId.make("send") },
  ],
};

const audienceFilter: AudienceFilter = {
  _tag: "Group",
  operator: "and",
  filters: [
    {
      attribute: "locale",
      _tag: "Condition",
      operator: "anyOf",
      value: ["cs-CZ"],
    },
  ],
};

const copy: AutomationPublishableCopy = {
  purpose: "marketing",
  templateKey: "workspace",
  content,
  flow,
  audienceFilter,
};

/** The same value with every object's keys in reverse order. */
const reverseKeys = <Value>(value: Value): Value => {
  if (Array.isArray(value)) {
    return value.map(reverseKeys) as Value;
  }
  if (Predicate.isObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseKeys(entry)])
    ) as Value;
  }
  return value;
};

describe("hashAutomationDraft", () => {
  test("is a SHA-256 hex digest", () => {
    expect(hashAutomationDraft(copy)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("ignores key order", () => {
    expect(hashAutomationDraft(reverseKeys(copy))).toBe(
      hashAutomationDraft(copy)
    );
  });

  test("ignores the order of calendar values", () => {
    const reordered: AutomationFlow = {
      ...flow,
      trigger: {
        _tag: "Schedule",
        calendar: { weekdays: ["friday", "monday"], hours: [9], minutes: [0] },
      },
    };
    expect(hashAutomationDraft({ ...copy, flow: reordered })).toBe(
      hashAutomationDraft(copy)
    );
  });

  test.each<[string, AutomationPublishableCopy]>([
    [
      "the flow",
      {
        ...copy,
        flow: {
          ...flow,
          steps: flow.steps.map((step) =>
            step._tag === "Wait"
              ? { ...step, wait: { _tag: "Duration", count: 3, unit: "day" } }
              : step
          ),
        },
      },
    ],
    [
      "a saved audience the flow names",
      {
        ...copy,
        flow: {
          ...flow,
          steps: flow.steps.map((step) =>
            step._tag === "Condition"
              ? {
                  ...step,
                  filter: {
                    _tag: "InAudience",
                    audienceId: campaignAudienceIdSchema.make("lapsed"),
                    operator: "in",
                  },
                }
              : step
          ),
        },
      },
    ],
    [
      "the content",
      {
        ...copy,
        content: {
          ...content,
          "en-US": {
            subject: "Come back soon",
            preheader: "Offer",
            body: body("Hi"),
          },
        },
      },
    ],
    ["the purpose", { ...copy, purpose: "operational" }],
    // Only one template exists yet; any other key must change the hash.
    ["the template", { ...copy, templateKey: "other" as CampaignTemplateKey }],
    [
      "the audience filter",
      {
        ...copy,
        audienceFilter: { ...audienceFilter, operator: "or" },
      },
    ],
  ])("changes with %s", (_, changed) => {
    expect(hashAutomationDraft(changed)).not.toBe(hashAutomationDraft(copy));
  });
});
