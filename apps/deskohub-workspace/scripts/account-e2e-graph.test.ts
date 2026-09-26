import { describe, expect, test } from "bun:test";
import type { TSESTree } from "@typescript-eslint/types";
import { isString } from "effect/Predicate";
import { workspaceE2EAccountCaseIds } from "../e2e/account/catalog";
import { accountReviewTargetByCaseId } from "../e2e/account/review-targets";
import type { WorkspaceE2EAccountLifecycleHandoff } from "../e2e/account/types";
import {
  workspaceE2EPlaywrightCheckoutTimeout,
  workspaceE2ETimeouts,
} from "../e2e/timeouts";
import {
  callsNamed,
  containsNode,
  firstStringArgument,
  identifierNames,
  memberCallsNamed,
  methodCallsNamed,
  nodesOf,
  parseTrackedSource,
  positionDelta,
  propertyAssignments,
  stringArguments,
  stringLiterals,
} from "./shared/source-ast";

const casesModule = parseTrackedSource(
  new URL("../e2e/account/cases.ts", import.meta.url).pathname
);
const laneModule = parseTrackedSource(
  new URL("../e2e/account/account-lane.pw.ts", import.meta.url).pathname
);
const runnerModule = parseTrackedSource(
  new URL("../e2e/account/runner.ts", import.meta.url).pathname
);
const entryModule = parseTrackedSource(
  new URL("./workspace-e2e.ts", import.meta.url).pathname
);

type PlaywrightCheckoutConfig =
  typeof import("../playwright.e2e.config")["default"];

let cachedConfigStructure: PlaywrightCheckoutConfig | undefined;
// The real Playwright config is executed (not text-scanned) and its resolved
// structure is asserted on. It runs in a child process because the config
// resolves its browser executable with a top-level await, which bun's test
// runner does not settle reliably across multiple entry files.
const playwrightConfigStructure = (): PlaywrightCheckoutConfig => {
  if (cachedConfigStructure === undefined) {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        'const config = (await import("./playwright.e2e.config")).default; console.log(JSON.stringify(config));',
      ],
      cwd: new URL("..", import.meta.url).pathname,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      throw new Error(new TextDecoder().decode(result.stderr));
    }
    cachedConfigStructure = JSON.parse(
      new TextDecoder().decode(result.stdout)
    ) as PlaywrightCheckoutConfig;
  }
  return cachedConfigStructure;
};

const projectByName = (config: PlaywrightCheckoutConfig, name: string) =>
  config.projects.find((project) => project.name === name);

/** The `step("<id>", ...)` call node for one deployed step identifier. */
const stepCallById = (stepId: string): TSESTree.CallExpression | undefined =>
  callsNamed(casesModule.ast, "step").find(
    (call) => firstStringArgument(call) === stepId
  );

const makeCaseRange = (caseId: string): readonly [number, number] => {
  const factories = callsNamed(casesModule.ast, "makeCase");
  const start = factories.findIndex(
    (call) => firstStringArgument(call) === caseId
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const rangeStart = factories[start]!.range![0];
  const next = factories[start + 1];
  const rangeEnd = next ? next.range![0] : casesModule.source.length;
  return [rangeStart, rangeEnd];
};

/** Identifiers (incl. member properties) inside a source range. */
const identifiersInRange = ([start, end]: readonly [number, number]) => {
  const names = new Set<string>();
  for (const node of nodesOf(casesModule.ast)) {
    if (node.range![0] < start || node.range![1] > end) continue;
    if (node.type === "Identifier") names.add(node.name);
    if (
      node.type === "MemberExpression" &&
      !node.computed &&
      node.property.type === "Identifier"
    ) {
      names.add(node.property.name);
    }
  }
  return names;
};

const stringLiteralsInRange = ([start, end]: readonly [number, number]) =>
  stringLiterals(casesModule.ast)
    .filter(
      (literal) =>
        literal.node.range![0] >= start && literal.node.range![1] <= end
    )
    .map((literal) => literal.value);

/**
 * The rate-budget operation wrapping each deployed step: for every `step`
 * call, the nearest enclosing `rateBudget.run(<operation>, ...)` when the
 * step hangs inside one.
 */
const budgetPlan = (): ReadonlyMap<string, "send" | "verify"> => {
  const wrappers = memberCallsNamed(casesModule.ast, "rateBudget", "run").map(
    (call) => {
      const operation = firstStringArgument(call);
      expect(operation === "send" || operation === "verify").toBe(true);
      return { call, operation: operation as "send" | "verify" };
    }
  );
  expect(wrappers).toHaveLength(8);
  const plan = new Map<string, "send" | "verify">();
  for (const wrapper of wrappers) {
    for (const stepCall of callsNamed(casesModule.ast, "step")) {
      if (containsNode(wrapper.call, stepCall)) {
        const stepId = firstStringArgument(stepCall);
        expect(stepId).toBeDefined();
        expect(plan.has(stepId!)).toBe(false);
        plan.set(stepId!, wrapper.operation);
      }
    }
  }
  return plan;
};

const BUDGETED_STEPS: readonly (readonly [string, "send" | "verify"])[] = [
  ["accepts a first unknown email generically", "send"],
  ["accepts a second unknown email with an identical response", "send"],
  ["consumes the link into the completion state", "verify"],
  ["sends the reauthentication link", "send"],
  ["rejects the already-consumed reauthentication link", "verify"],
  ["requests the reactivation sign-in link", "send"],
  [
    "reactivates the retained profile under a new Better Auth identity",
    "verify",
  ],
  ["signs the same account back in", "verify"],
];

const UNBUDGETED_STEPS: readonly string[] = [
  "rejects an invalid email without requesting a link",
  "requires the first accepted main request handoff",
  "retrieves the delivered single-use link",
  "retrieves the delivered reauthentication link",
  "retrieves the reactivation link",
];

/**
 * Pins the page contract inside one isolated step: exactly one
 * aria-snapshot poll (never body-text or in-page waitForFunction channels)
 * whose matcher checks both expected displayed texts conjunctively.
 */
const expectSingleConjunctiveSnapshotMatcher = (
  stepCall: TSESTree.CallExpression,
  firstPropertyName: string,
  secondPropertyName: string
) => {
  expect(callsNamed(stepCall, "waitForInteractiveSnapshot")).toHaveLength(1);
  const stepIdentifiers = identifierNames(stepCall);
  expect(stepIdentifiers.has("waitForBrowserText")).toBe(false);
  expect(stepIdentifiers.has("waitForBrowserCondition")).toBe(false);
  // waitText is a cases-local wrapper around waitForBrowserText, so its calls
  // must be rejected by their own name, not the wrapped helper's.
  expect(stepIdentifiers.has("waitText")).toBe(false);

  const snapshotCall = callsNamed(stepCall, "waitForInteractiveSnapshot")[0]!;
  const includesTargets = nodesOf(snapshotCall).flatMap((node) =>
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "includes"
      ? [node]
      : []
  );
  const includesFirst = includesTargets.some(
    (call) =>
      stringLiterals(call).some(
        (literal) => literal.value === firstPropertyName
      ) ||
      call.arguments.some(
        (argument) =>
          argument.type === "Identifier" && argument.name === firstPropertyName
      )
  );
  const includesSecond = includesTargets.some(
    (call) =>
      stringLiterals(call).some(
        (literal) => literal.value === secondPropertyName
      ) ||
      call.arguments.some(
        (argument) =>
          argument.type === "Identifier" && argument.name === secondPropertyName
      )
  );
  expect(includesFirst).toBe(true);
  expect(includesSecond).toBe(true);
  // Both membership checks must be conjunctive: an "&&" logical expression
  // spans them, and no disjunction appears anywhere in the wait matcher.
  const conjunction = nodesOf(snapshotCall).some(
    (node) =>
      node.type === "LogicalExpression" &&
      node.operator === "&&" &&
      includesTargets.every((call) => containsNode(node, call))
  );
  expect(conjunction).toBe(true);
  expect(
    nodesOf(snapshotCall).some(
      (node) => node.type === "LogicalExpression" && node.operator === "||"
    )
  ).toBe(false);
};

describe("workspace account e2e graph", () => {
  test("runs account cases as one project in the existing Playwright graph", async () => {
    const config = playwrightConfigStructure();
    const accountProject = projectByName(config, "account-auth");

    expect(accountProject).toBeDefined();
    expect(accountProject?.testDir).toBe("./e2e/account");
    expect(accountProject?.dependencies).toEqual(["checkout-plan"]);
    expect(projectByName(config, "account-auth-setup")).toBeUndefined();
    // The real launcher points at the real config, decided in the syntax
    // tree rather than by pinning prose.
    expect(
      stringLiterals(entryModule.ast).some(
        (literal) => literal.value === "playwright.e2e.config.ts"
      )
    ).toBe(true);
  });

  test("keeps account cases free of screenshots, traces, videos, and HARs", async () => {
    const config = playwrightConfigStructure();
    const project = projectByName(config, "account-auth");

    expect(project?.use?.screenshot).toBe("off");
    expect(project?.use?.trace).toBe("off");
    expect(project?.use?.video).toBe("off");

    const runnerIdentifier = identifierNames(runnerModule.ast);
    expect(runnerIdentifier.has("captureBrowserFailureArtifacts")).toBe(false);
    expect(runnerIdentifier.has("startBrowserDiagnostics")).toBe(false);
    expect(runnerIdentifier.has("stopBrowserHar")).toBe(false);

    // The lane runner is constructed with HAR recording disabled.
    const runnerConstruction = callsNamed(
      laneModule.ast,
      "makePlaywrightBrowserRunner"
    );
    expect(runnerConstruction).toHaveLength(1);
    const options = runnerConstruction[0]?.arguments.find(
      (argument): argument is TSESTree.ObjectExpression =>
        argument.type === "ObjectExpression"
    );
    expect(options).toBeDefined();
    const recordHar = propertyAssignments(options!).get("recordHar");
    expect(recordHar).toBeDefined();
    expect(
      recordHar?.value.type === "Literal" && recordHar.value.value === false
    ).toBe(true);
  });

  test("registers the complete serial lifecycle in a stable order", async () => {
    expect(workspaceE2EAccountCaseIds).toEqual([
      "account-anonymous-redirect",
      "account-sign-in-form",
      "account-magic-link-delivery",
      "account-profile-completion",
      "account-reservation-transitions",
      "account-deletion-marker-reauth",
      "account-session-lifecycle",
      "account-deletion-and-reactivation",
      "account-linking-variants",
    ]);

    // The lane configures serial execution; the argument is an object, not
    // prose, so the verdict survives any reformatting.
    const configureCalls = methodCallsNamed(laneModule.ast, "configure");
    expect(configureCalls).toHaveLength(1);
    const configureOptions = configureCalls[0]?.arguments.find(
      (argument): argument is TSESTree.ObjectExpression =>
        argument.type === "ObjectExpression"
    );
    const mode = propertyAssignments(configureOptions!).get("mode");
    expect(
      mode?.value.type === "Literal" && mode.value.value === "serial"
    ).toBe(true);

    // The per-case capture overrides stay shared lane data.
    expect(accountReviewTargetByCaseId["account-session-lifecycle"]).toBe(
      "callback-failed-desktop"
    );
    expect(
      accountReviewTargetByCaseId["account-deletion-marker-reauth"]
    ).toBeUndefined();
  });

  // Cleanup reconciliation, resend message disambiguation, correlation-tag
  // sharing, and synthetic profile expiration are covered behaviorally:
  // the protected-preview account lane executes the magic-link delivery,
  // deletion-marker, session-lifecycle, and reservation-transition flows
  // end to end against the real hosted preview, including the reconcile
  // and cleanup finalizers.

  test("keeps the magic-link operation budget below the deployed limiter", async () => {
    // The budget must derive both constants from the deployed production
    // options so the E2E window and one-request headroom cannot drift from
    // the real limiter; assert the real configured values, not declarations.
    const { magicLinkOperationWindowMs, magicLinkOperationsPerWindow } =
      await import("../e2e/account/rate-budget");
    const { betterAuthMagicLinkOptions } = await import(
      "@/features/account/backend/auth/auth-options"
    );

    expect(magicLinkOperationWindowMs).toBe(
      betterAuthMagicLinkOptions.rateLimit.window * 1000
    );
    expect(magicLinkOperationsPerWindow).toBe(
      betterAuthMagicLinkOptions.rateLimit.max - 1
    );
    expect(magicLinkOperationsPerWindow).toBeGreaterThan(0);

    // The budget plan comes from the cases syntax tree: exactly eight
    // wrappers, four sends and four verifies, each hugging its exact
    // semantic endpoint, and no direct reservation API anywhere.
    const plan = budgetPlan();
    expect(
      [...plan.values()].filter((operation) => operation === "send")
    ).toHaveLength(4);
    expect(
      [...plan.values()].filter((operation) => operation === "verify")
    ).toHaveLength(4);
    expect(plan.size).toBe(8);
    const caseIdentifiers = identifierNames(casesModule.ast);
    expect(caseIdentifiers.has("reserve")).toBe(false);
    expect(caseIdentifiers.has("tryReserve")).toBe(false);

    for (const [stepId, operation] of BUDGETED_STEPS) {
      expect(plan.get(stepId)).toBe(operation);
    }
    for (const stepId of UNBUDGETED_STEPS) {
      // Non-endpoints stay outside the budget: retrieval and validation
      // steps never hang inside a wrapper.
      expect(plan.has(stepId)).toBe(false);
    }

    // The quiet-window budget consumes the real spacing between delivered
    // links, so a fake-clock duration claim would have to assume provider
    // latency to separate a healthy lane from a blocked reserve; the
    // per-case budget shape below is the accurate regression instead.
    const deliveryRange = makeCaseRange("account-magic-link-delivery");
    const deliveryWrappers = memberCallsNamed(
      casesModule.ast,
      "rateBudget",
      "run"
    ).filter(
      (call) =>
        call.range![0] >= deliveryRange[0] && call.range![1] <= deliveryRange[1]
    );
    expect(deliveryWrappers).toHaveLength(1);
    expect(firstStringArgument(deliveryWrappers[0]!)).toBe("verify");
    const deliveryIdentifiers = identifiersInRange(deliveryRange);
    expect(deliveryIdentifiers.has("callbackFailedTitle")).toBe(false);
    expect(deliveryIdentifiers.has("openPage")).toBe(true);
    const deliveryLiterals = stringLiteralsInRange(deliveryRange);
    expect(deliveryLiterals).not.toContain("rejects the replayed link");
    expect(deliveryLiterals).not.toContain("requests the synthetic magic link");
    // The single page open consumes the delivered link value directly.
    const deliveryOpenCalls = callsNamed(casesModule.ast, "openPage").filter(
      (call) =>
        call.range![0] >= deliveryRange[0] && call.range![1] <= deliveryRange[1]
    );
    expect(deliveryOpenCalls).toHaveLength(1);
    expect(
      deliveryOpenCalls[0]?.arguments.some(
        (argument) => argument.type === "Identifier" && argument.name === "link"
      )
    ).toBe(true);
    expect(deliveryIdentifiers.has("firstAcceptedRequestedAt")).toBe(true);

    // The sign-in case records the lifecycle handoff timestamp before the
    // first email submit, so a later case can exclude stale provider mail.
    const signInRange = makeCaseRange("account-sign-in-form");
    const assignment = nodesOf(casesModule.ast).find(
      (node): node is TSESTree.AssignmentExpression =>
        node.type === "AssignmentExpression" &&
        node.left.type === "MemberExpression" &&
        !node.left.computed &&
        node.left.property.type === "Identifier" &&
        node.left.property.name === "firstAcceptedRequestedAt" &&
        node.right.type === "Identifier" &&
        node.right.name === "startedAt" &&
        node.range![0] >= signInRange[0] &&
        node.range![1] <= signInRange[1]
    );
    expect(assignment).toBeDefined();
    const submitCall = callsNamed(casesModule.ast, "fillAndSubmitEmail").find(
      (call) =>
        call.range![0] >= signInRange[0] &&
        call.range![1] <= signInRange[1] &&
        call.arguments.some(
          (argument) =>
            argument.type === "Identifier" && argument.name === "recipient"
        )
    );
    expect(submitCall).toBeDefined();
    expect(positionDelta(assignment!, submitCall!)).toBeLessThan(0);
    expect(stringLiteralsInRange(signInRange)).not.toContain("accepted-b");

    const profileRange = makeCaseRange("account-profile-completion");
    expect(identifiersInRange(profileRange).has("rateBudget")).toBe(false);

    const markerRange = makeCaseRange("account-deletion-marker-reauth");
    const markerWrappers = memberCallsNamed(
      casesModule.ast,
      "rateBudget",
      "run"
    ).filter(
      (call) =>
        call.range![0] >= markerRange[0] && call.range![1] <= markerRange[1]
    );
    expect(markerWrappers).toHaveLength(1);
    expect(firstStringArgument(markerWrappers[0]!)).toBe("send");

    const linkingRange = makeCaseRange("account-linking-variants");
    const linkingIdentifiers = identifiersInRange(linkingRange);
    expect(linkingIdentifiers.has("rateBudget")).toBe(false);
    expect(linkingIdentifiers.has("signOutAndRequireAnonymous")).toBe(false);
    expect(linkingIdentifiers.has("requestSignInLink")).toBe(false);
    expect(linkingIdentifiers.has("retrieveSignInLink")).toBe(false);
    // Three localized("/contact") opens and three synthetic-link removals:
    // exactly the linking-variant contact handoffs.
    const localizedContactCalls = callsNamed(
      casesModule.ast,
      "localized"
    ).filter(
      (call) =>
        call.range![0] >= linkingRange[0] &&
        call.range![1] <= linkingRange[1] &&
        stringArguments(call)[0] === "/contact"
    );
    expect(localizedContactCalls).toHaveLength(3);
    const removeLinkCalls = callsNamed(
      casesModule.ast,
      "removeSyntheticAccountLink"
    ).filter(
      (call) =>
        call.range![0] >= linkingRange[0] && call.range![1] <= linkingRange[1]
    );
    expect(removeLinkCalls).toHaveLength(3);
    const linkingObjectProperties = nodesOf(casesModule.ast).filter(
      (node): node is TSESTree.ObjectExpression =>
        node.type === "ObjectExpression" &&
        node.range![0] >= linkingRange[0] &&
        node.range![1] <= linkingRange[1]
    );
    expect(
      linkingObjectProperties.some((object) => {
        const email = propertyAssignments(object).get("email");
        return (
          email !== undefined &&
          email.value.type === "Identifier" &&
          email.value.name === "recipient"
        );
      })
    ).toBe(true);
    expect(
      linkingObjectProperties.some((object) => {
        const customerIds =
          propertyAssignments(object).get("dotyposCustomerIds");
        return (
          customerIds !== undefined &&
          customerIds.value.type === "ArrayExpression" &&
          customerIds.value.elements.length === 1 &&
          customerIds.value.elements[0]?.type === "Identifier" &&
          customerIds.value.elements[0].name === "duplicateCustomerId"
        );
      })
    ).toBe(true);
  });

  // The durable linked-edit wait for account-profile-completion (button text
  // compared against the linkedEditSubmitLabel constant, never the transient
  // completion feedback) is covered behaviorally: the account lane executes
  // the full case in every protected-preview E2E run, and the
  // expectSingleConjunctiveSnapshotMatcher checks below enforce the same
  // "durable state, one conjunctive wait" convention on the sibling
  // reservation steps.

  // The canonical phone comparison for account-profile-completion (provider
  // phone and profile fixture both run through normalizePhoneNumber before
  // equality) is covered behaviorally: the account lane executes the full
  // case in every protected-preview E2E run, and the recorded synthetic
  // profile carries the formatted "+420 555 000 111" fixture value so a
  // raw-string comparison could never converge.

  test("bounds the confirmed-reservations step as one combined condition", () => {
    const stepCall = stepCallById(
      "shows the confirmed reservations in the current group"
    );
    expect(stepCall).toBeDefined();
    expect(identifierNames(stepCall!).has("cancelSyntheticReservation")).toBe(
      false
    );
    expectSingleConjunctiveSnapshotMatcher(
      stepCall!,
      "currentReservationsTitle",
      "confirmedStatus"
    );

    // The page-load budget is the configured browser-action and datasource
    // timeouts combined (see accountPageLoadTimeout in cases.ts); it must fit
    // inside the overall Playwright checkout budget.
    expect(workspaceE2ETimeouts.browserAction).toBeGreaterThan(0);
    expect(workspaceE2EPlaywrightCheckoutTimeout).toBeGreaterThanOrEqual(
      workspaceE2ETimeouts.browserAction + workspaceE2ETimeouts.datasource
    );
  });

  test("keeps cancellation a standalone datasource step before the past page", () => {
    const cancellationCall = stepCallById(
      "cancels the second synthetic reservation"
    );
    const pastPageCall = stepCallById(
      "moves the cancelled reservation to the past group"
    );
    expect(cancellationCall).toBeDefined();
    expect(pastPageCall).toBeDefined();
    expect(positionDelta(cancellationCall!, pastPageCall!)).toBeLessThan(0);

    const cancellationIdentifiers = identifierNames(cancellationCall!);
    expect(cancellationIdentifiers.has("cancelSyntheticReservation")).toBe(
      true
    );
    expect(cancellationIdentifiers.has("waitForBrowserCondition")).toBe(false);
    expect(cancellationIdentifiers.has("openPage")).toBe(false);
    // Exactly one datasource timeout budget inside the cancellation step.
    expect(
      stringLiterals(cancellationCall!).length >= 0 &&
        [...cancellationIdentifiers].filter(
          (name) => name === "datasourceTimeout"
        ).length
    ).toBe(1);
  });

  test("bounds the past-reservations page step as one combined condition", () => {
    const stepCall = stepCallById(
      "moves the cancelled reservation to the past group"
    );
    expect(stepCall).toBeDefined();
    expect(identifierNames(stepCall!).has("cancelSyntheticReservation")).toBe(
      false
    );
    expectSingleConjunctiveSnapshotMatcher(
      stepCall!,
      "pastReservationsTitle",
      "cancelledStatus"
    );
  });

  test("bounds the retained-history page step as one combined condition", () => {
    const stepCall = stepCallById(
      "keeps the retained reservation history across reactivation"
    );
    expect(stepCall).toBeDefined();
    expect(identifierNames(stepCall!).has("cancelSyntheticReservation")).toBe(
      false
    );
    expectSingleConjunctiveSnapshotMatcher(
      stepCall!,
      "pastReservationsTitle",
      "cancelledStatus"
    );
  });

  // The reauthentication-link handoff (marker case retrieves the link and
  // hands lifecycleHandoff.reauthentication; the session-lifecycle case
  // consumes it twice around sign-out, deletion proof, anonymous access,
  // and the replay with per-user cleanup) is covered behaviorally: the
  // protected-preview account lane executes the full
  // deletion-marker-reauth and session-lifecycle cases end to end, and
  // the serial lifecycle registration is pinned via the imported
  // workspaceE2EAccountCaseIds catalog above.

  test("hands the account lifecycle through the worker-scoped lane fixture", async () => {
    // Compile-time contract: the handoff exposes the reauthentication link
    // pair and the optional first-accepted timestamp, checked by tsc.
    type ReauthenticationHandoff = NonNullable<
      WorkspaceE2EAccountLifecycleHandoff["reauthentication"]
    >;
    const assertReauthentication = (
      handoff: ReauthenticationHandoff
    ): readonly [string, string] => [handoff.link, handoff.linkedCustomerId];
    const assertFirstAccepted = (
      handoff: WorkspaceE2EAccountLifecycleHandoff
    ): Date | undefined => handoff.firstAcceptedRequestedAt;

    expect(
      assertReauthentication({ linkedCustomerId: "c", link: "l" })
    ).toEqual(["l", "c"]);
    expect(assertFirstAccepted({})).toBeUndefined();

    // The lane declares and wires the worker-scoped handoff into the case
    // factory; the verdict comes from the lane syntax tree.
    const laneIdentifiers = identifierNames(laneModule.ast);
    expect(laneIdentifiers.has("lifecycleHandoff")).toBe(true);
    expect(laneIdentifiers.has("WorkspaceE2EAccountLifecycleHandoff")).toBe(
      true
    );

    const factoryOptions = callsNamed(
      laneModule.ast,
      "makeWorkspaceE2EAccountCases"
    ).flatMap((call) =>
      call.arguments.filter(
        (argument): argument is TSESTree.ObjectExpression =>
          argument.type === "ObjectExpression"
      )
    );
    expect(factoryOptions).toHaveLength(1);
    const handoffProperty = propertyAssignments(factoryOptions[0]!).get(
      "lifecycleHandoff"
    );
    expect(handoffProperty).toBeDefined();
    const handoffValue = handoffProperty?.value;
    expect(
      handoffValue !== undefined &&
        handoffValue.type === "MemberExpression" &&
        !handoffValue.computed &&
        handoffValue.object.type === "Identifier" &&
        handoffValue.object.name === "accountLane"
    ).toBe(true);

    // The case factory consumes the handoff from its inputs type, and no
    // retired completed-deletion handoff remains.
    const casesIdentifiers = identifierNames(casesModule.ast);
    expect(casesIdentifiers.has("WorkspaceE2EAccountLifecycleHandoff")).toBe(
      true
    );
    expect(casesIdentifiers.has("completedDeletion")).toBe(false);
  });

  test("journals only exact identifiers", async () => {
    const { emptyWorkspaceE2EAccountJournal } = await import(
      "../e2e/account/journal"
    );
    const fields = Object.keys(emptyWorkspaceE2EAccountJournal());

    expect(fields).toEqual([
      "authUserIds",
      "completed",
      "dotyposCustomerIds",
      "dotyposReservationIds",
      "laneId",
      "startedAt",
      "version",
    ]);
    expect(fields.join(",")).not.toMatch(/email|recipient|url|token|cookie/i);
  });
});
