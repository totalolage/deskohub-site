import type {
  NexiHostedPaymentPageStateCode,
  NexiHostedPaymentStep,
} from "../errors";
import type { NexiBuildResponse } from "./nexi-build-api";

// Pure model of the Nexi XPay hosted payment page as seen through Playwright AI
// snapshots and the session's response log. The driver polls this model; it
// never decides from a single command result.

// Each control is also the hosted-payment step its activation completes.
export type NexiHostedControl = Exclude<NexiHostedPaymentStep, "card_entry">;

// Accessible names, compared case-insensitively. The page renders some labels
// upper-case through CSS, so the accessible name is the authority.
export const nexiHostedControlNames: Readonly<
  Record<NexiHostedControl, readonly string[]>
> = {
  challenge: ["Authentication successful", "Autenticazione riuscita"],
  continue: ["Continue", "Continua"],
  pay: ["Pay", "Paga"],
  return: ["Back to the shop", "Torna al negozio"],
};

export type NexiCardField =
  | "card_number"
  | "expiration_date"
  | "security_code"
  | "cardholder_name"
  | "cardholder_email";

export const nexiCardFieldNames: Readonly<
  Record<NexiCardField, readonly string[]>
> = {
  card_number: ["Card number", "Numero carta", "Numero della carta"],
  cardholder_email: ["Email", "E-mail"],
  cardholder_name: ["First Name", "Cardholder name", "Nome", "Titolare"],
  expiration_date: ["Expiration date", "Scadenza", "Data scadenza"],
  security_code: ["CVV", "CVC", "Codice sicurezza"],
};

const requiredNexiCardFields = [
  "card_number",
  "expiration_date",
  "security_code",
] as const satisfies readonly NexiCardField[];

const providerErrorPageHeadings = ["Payment error"];
const providerFailurePageHeadings = ["OPS! Something went wrong"];

export type NexiSnapshotNode = {
  readonly disabled: boolean;
  // The main-document iframe that contains this node, when it is framed.
  readonly frameRef?: string;
  readonly indent: number;
  readonly name?: string;
  readonly ref?: string;
  readonly role: string;
};

const snapshotLinePattern = /^(\s*)-\s+([^\s"[:]+)(?:\s+"([^"]*)")?(.*)$/;

export const parseNexiSnapshot = (
  snapshot: string
): readonly NexiSnapshotNode[] => {
  const nodes: NexiSnapshotNode[] = [];
  const frames: { readonly indent: number; readonly ref?: string }[] = [];

  for (const line of snapshot.split("\n")) {
    const match = line.match(snapshotLinePattern);
    if (!match) continue;
    const indent = match[1]?.length ?? 0;
    const role = match[2]?.toLowerCase() ?? "";
    const rest = match[4] ?? "";
    while (frames.length > 0 && (frames.at(-1)?.indent ?? 0) >= indent)
      frames.pop();

    const ref = rest.match(/\bref=((?:f\d+)?e\d+)\b/)?.[1];
    const frameRef = frames[0]?.ref;
    nodes.push({
      disabled: /\[[^\]]*\bdisabled\b[^\]]*\]/i.test(rest),
      ...(frameRef ? { frameRef: `@${frameRef}` } : {}),
      indent,
      ...(match[3] === undefined ? {} : { name: match[3].trim() }),
      ...(ref ? { ref: `@${ref}` } : {}),
      role,
    });
    if (role === "iframe") frames.push({ indent, ref });
  }

  return nodes;
};

const normalizeName = (value: string) =>
  value.replaceAll(/\s+/g, " ").trim().toLowerCase();

// Exact accessible-name match first; a label followed by more words (for
// example an amount after "Pay") is a weaker match. Substrings inside another
// word or later in the name never match, so "Abort payment" is not "Pay".
const scoreAccessibleName = (
  name: string | undefined,
  labels: readonly string[]
) => {
  if (name === undefined) return 0;
  const normalized = normalizeName(name);
  let score = 0;
  for (const label of labels.map(normalizeName)) {
    if (normalized === label) return 2;
    if (normalized.startsWith(`${label} `)) score = 1;
  }
  return score;
};

export type NexiControlTarget = {
  readonly enabled: boolean;
  readonly ref: string;
};

export const findNexiControl = (
  nodes: readonly NexiSnapshotNode[],
  control: NexiHostedControl
): NexiControlTarget | undefined => {
  let best: { node: NexiSnapshotNode; score: number } | undefined;
  for (const node of nodes) {
    if (node.role !== "button" || node.frameRef || !node.ref) continue;
    const score = scoreAccessibleName(
      node.name,
      nexiHostedControlNames[control]
    );
    if (score === 0) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && best.node.disabled && !node.disabled)
    )
      best = { node, score };
  }
  return best?.node.ref
    ? { enabled: !best.node.disabled, ref: best.node.ref }
    : undefined;
};

export type NexiCardFieldTarget = {
  readonly enabled: boolean;
  // The iframe to enter before acting on the field, or undefined when the
  // field is part of the main document.
  readonly frameRef?: string;
  readonly ref: string;
};

export const findNexiCardField = (
  nodes: readonly NexiSnapshotNode[],
  field: NexiCardField
): NexiCardFieldTarget | undefined => {
  const node = nodes.find(
    (candidate) =>
      candidate.role === "textbox" &&
      candidate.ref !== undefined &&
      scoreAccessibleName(candidate.name, nexiCardFieldNames[field]) === 2
  );
  if (!node?.ref) return undefined;
  return {
    enabled: !node.disabled,
    ...(node.frameRef ? { frameRef: node.frameRef } : {}),
    ref: node.ref,
  };
};

// Card details are saved by POST; Nexi leaves the form inert after any failed
// save, whether it rejects the data or fails server-side.
export const countNexiCardDataRejections = (
  responses: readonly NexiBuildResponse[]
) =>
  responses.filter(
    (response) =>
      response.endpoint === "card-data" &&
      response.method === "POST" &&
      response.status >= 400
  ).length;

export const formatNexiBuildFailures = (
  responses: readonly NexiBuildResponse[]
) => {
  const counts = new Map<string, number>();
  for (const response of responses) {
    if (response.status < 400) continue;
    const key = `${response.endpoint} HTTP ${response.status}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts.size === 0
    ? "Nexi build API failures: none observed"
    : `Nexi build API failures: ${[...counts]
        .map(([key, count]) => (count > 1 ? `${key} x${count}` : key))
        .join(", ")}`;
};

export type NexiHostedPageState =
  | { readonly kind: "returned" }
  | { readonly kind: "provider-error-page" }
  | { readonly kind: "provider-failure-page" }
  | { readonly kind: "card-submission-rejected" }
  | {
      readonly control: NexiHostedControl;
      readonly enabled: boolean;
      readonly kind: "control";
    }
  | { readonly kind: "card-entry"; readonly ready: boolean }
  | { readonly kind: "unknown"; readonly providerServerError: boolean }
  | { readonly kind: "snapshot-unavailable" };

export type NexiHostedPageObservation = {
  // Card-data saves Nexi rejected since the driver started this payment.
  readonly cardDataRejections: number;
  readonly isReturnUrl: boolean;
  readonly responses: readonly NexiBuildResponse[];
  readonly snapshot: string;
  readonly url?: string;
};

const isNexiErrorPageUrl = (value: string | undefined) => {
  try {
    return /\/hpp\/[^/]+\/error\/?$/.test(new URL(value ?? "").pathname);
  } catch {
    return false;
  }
};

const hasHeading = (
  nodes: readonly NexiSnapshotNode[],
  headings: readonly string[]
) =>
  nodes.some(
    (node) =>
      node.role === "heading" &&
      !node.frameRef &&
      scoreAccessibleName(node.name, headings) === 2
  );

export const classifyNexiHostedPage = (
  observation: NexiHostedPageObservation
): NexiHostedPageState => {
  if (observation.isReturnUrl) return { kind: "returned" };
  if (isNexiErrorPageUrl(observation.url))
    return { kind: "provider-error-page" };
  if (!observation.snapshot.trim()) return { kind: "snapshot-unavailable" };

  const nodes = parseNexiSnapshot(observation.snapshot);
  if (hasHeading(nodes, providerErrorPageHeadings))
    return { kind: "provider-error-page" };
  if (hasHeading(nodes, providerFailurePageHeadings))
    return { kind: "provider-failure-page" };

  for (const control of ["return", "challenge", "pay"] as const) {
    const target = findNexiControl(nodes, control);
    if (target) return { control, enabled: target.enabled, kind: "control" };
  }

  const cardFields = requiredNexiCardFields.map((field) =>
    findNexiCardField(nodes, field)
  );
  if (cardFields.some((field) => field !== undefined)) {
    // Nexi leaves the form inert (fields disabled, no error page) after it
    // rejects the card-data save, so the page alone cannot tell this apart
    // from a slow transition.
    if (observation.cardDataRejections > 0)
      return { kind: "card-submission-rejected" };
    return {
      kind: "card-entry",
      ready: cardFields.every((field) => field?.enabled === true),
    };
  }

  const continueTarget = findNexiControl(nodes, "continue");
  if (continueTarget)
    return {
      control: "continue",
      enabled: continueTarget.enabled,
      kind: "control",
    };

  return {
    kind: "unknown",
    providerServerError: observation.responses.some(
      (response) => response.status >= 500
    ),
  };
};

// States the provider will not leave on its own; waiting longer only hides the
// provider failure behind a generic timeout.
export const isTerminalNexiHostedPageState = (state: NexiHostedPageState) =>
  state.kind === "provider-error-page" ||
  state.kind === "provider-failure-page" ||
  state.kind === "card-submission-rejected";

export const toNexiHostedPageStateCode = (
  state: NexiHostedPageState
): NexiHostedPaymentPageStateCode | undefined => {
  switch (state.kind) {
    case "returned":
      return undefined;
    case "provider-error-page":
      return "provider_error_page";
    case "provider-failure-page":
      return "provider_failure_page";
    case "card-submission-rejected":
      return "card_submission_rejected";
    case "control":
      return `${state.control}_${state.enabled ? "enabled" : "disabled"}`;
    case "card-entry":
      return state.ready ? "card_entry_ready" : "card_entry_incomplete";
    case "unknown":
      return state.providerServerError ? "provider_server_error" : "unknown";
    case "snapshot-unavailable":
      return "snapshot_unavailable";
  }
};

export const describeNexiHostedPageState = (state: NexiHostedPageState) => {
  switch (state.kind) {
    case "returned":
      return "returned to the checkout status page";
    case "provider-error-page":
      return "Nexi rendered its payment error page";
    case "provider-failure-page":
      return "Nexi rendered its generic failure page";
    case "card-submission-rejected":
      return "Nexi rejected the card-data save and left the card form inert";
    case "control":
      return `Nexi ${state.control} control is ${state.enabled ? "enabled" : "disabled"}`;
    case "card-entry":
      return state.ready
        ? "Nexi card form is ready"
        : "Nexi card form is not ready";
    case "unknown":
      return state.providerServerError
        ? "Nexi page state is unknown after a Nexi server error"
        : "Nexi page state is unknown";
    case "snapshot-unavailable":
      return "Nexi page snapshot is unavailable";
  }
};
