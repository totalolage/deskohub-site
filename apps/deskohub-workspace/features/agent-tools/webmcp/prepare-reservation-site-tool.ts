import { Duration, Effect, Option, Schema } from "effect";
import { type Locale, m } from "@/features/i18n";
import type { ReservationFormSubmission } from "@/features/reservation/components/reservation-checkout-form";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import { runWorkspaceBrowserEffect } from "@/shared/browser/workspace-browser-effect";
import type { InvalidFormField } from "@/shared/utils/form-field-errors";
import {
  AgentToolRequestError,
  callAgentTool,
  type PublishedAgentTool,
} from "./agent-tool-mcp-client";
import {
  registerSiteTool,
  runSiteToolCall,
  withPageLocale,
} from "./register-site-tools";
import type {
  SiteToolReservationForm,
  SiteToolReservationFormHandle,
} from "./use-prepare-reservation-site-tool";
import type { ModelContext } from "./webmcp";

export const prepareReservationToolName = "prepare_reservation";

export const prepareReservationToolDescription =
  "Prepares a reservation in this browser tab up to the Pay page. It fills the reservation form on this page with a complete selection, the same input get_quote takes, waits for the live price and availability, and submits the form with the contact details the customer has already entered or the signed-in account. It never asks for or changes contact details: when some are missing, it says which, and the customer fills them in. For a selection in another reservation family, it opens that reservation page; run it again there. Set marketingConsent to true only when the customer has explicitly asked in this conversation to receive marketing communication; never infer or default it. The customer accepts the terms and operating rules and pays on the Pay page; this tool cannot do either.";

export const marketingConsentInputDescription =
  "Optional. Set to true only when the customer has explicitly asked, in this conversation, to receive Deskohub Workspace marketing communication (occasional news, event invitations and offers by email). Never infer it from other requests, never default it, and never set it on the customer's behalf. Otherwise omit it. Omitting it or sending false records no consent and never withdraws a consent the customer gave earlier.";

/**
 * The quote tool's published input plus the optional `marketingConsent`. It
 * has no default and isn't required: an omitted value is no consent, which
 * the tool enforces itself because browsers don't fill in defaults.
 */
export const getPrepareReservationInputSchema = (
  quoteTool: PublishedAgentTool
) => ({
  ...quoteTool.inputSchema,
  properties: {
    ...quoteTool.inputSchema.properties,
    marketingConsent: {
      type: "boolean",
      description: marketingConsentInputDescription,
    },
  },
});

// A selection's availability and price normally settle within seconds; the
// bound covers the slower provider timeouts outside production.
const formReadinessTimeout = Duration.seconds(45);

// The quote's link opens the reservation page on the validated selection;
// its other fields are the summary the result repeats.
const quoteSchema = Schema.Struct({
  family: workspaceReservationKindSchema,
  reservation_url: Schema.String,
});

type Quote = typeof quoteSchema.Type;

const contactFieldRoots = new Set(["name", "email", "phone", "billing"]);

type MarketingConsentOutcome =
  | "submitted"
  | "not_submitted"
  | "already_granted";

/** Registers `prepare_reservation` for the mounted form until `signal` aborts. */
export const registerPrepareReservationSiteTool = ({
  form,
  modelContext,
  quoteTool,
  signal,
}: {
  readonly form: SiteToolReservationFormHandle;
  readonly modelContext: ModelContext;
  readonly quoteTool: PublishedAgentTool;
  readonly signal: AbortSignal;
}) =>
  registerSiteTool(
    modelContext,
    {
      name: prepareReservationToolName,
      title: m.siteToolPrepareReservationTitle(
        {},
        { locale: form.current().locale }
      ),
      description: prepareReservationToolDescription,
      inputSchema: getPrepareReservationInputSchema(quoteTool),
      annotations: { readOnlyHint: false, consequentialHint: true },
      execute: (input, options) =>
        prepareReservation({ form, input, quoteTool }).pipe(
          runSiteToolCall(
            "agent-tools.site-tool.prepare_reservation",
            form.current().locale,
            options.signal
          )
        ),
    },
    signal
  ).pipe(
    runWorkspaceBrowserEffect(
      "agent-tools.site-tool.prepare_reservation.register",
      { signal }
    )
  );

/**
 * Quotes the selection through `get_quote`, which validates it and returns
 * the reservation link, then drives the form on this page through its own
 * submit path. Only the literal `true` gives marketing consent.
 */
const prepareReservation = ({
  form,
  input,
  quoteTool,
}: {
  readonly form: SiteToolReservationFormHandle;
  readonly input: Schema.JsonObject;
  readonly quoteTool: PublishedAgentTool;
}) => {
  const { marketingConsent, ...selection } = input;
  return callAgentTool(
    quoteTool.name,
    withPageLocale(quoteTool, selection, form.current().locale)
  ).pipe(
    Effect.flatMap((quote) =>
      quote.isError
        ? Effect.succeed<object>(quote.structuredContent)
        : Schema.decodeUnknownEffect(quoteSchema, {
            onExcessProperty: "preserve",
          })(quote.structuredContent).pipe(
            Effect.mapError((cause) => new AgentToolRequestError({ cause })),
            Effect.flatMap((decoded) =>
              prepareQuotedReservation({
                form,
                quote: decoded,
                requestsMarketingConsent: marketingConsent === true,
              })
            )
          )
    )
  );
};

const prepareQuotedReservation = Effect.fnUntraced(function* ({
  form,
  quote: { reservation_url, ...summary },
  requestsMarketingConsent,
}: {
  readonly form: SiteToolReservationFormHandle;
  readonly quote: Quote;
  readonly requestsMarketingConsent: boolean;
}) {
  const link = new URL(reservation_url, window.location.origin);
  const page = form.current();

  if (summary.family !== page.kind) {
    page.openReservationPage(summary.family, link.searchParams);
    return {
      status: "reservation_page_opened",
      family: summary.family,
      message: m.siteToolReservationPageOpened({}, { locale: page.locale }),
    };
  }

  const changed = page.applySelection(link.searchParams);
  const isReady = yield* awaitFormReadiness(form, changed);
  const settled = form.current();
  if (!isReady) {
    return siteToolError(
      "form_not_ready",
      m.siteToolFormNotReady({}, { locale: settled.locale })
    );
  }
  // The submit button stays disabled in both cases, so the tool stops too.
  if (settled.readiness.unavailableMessage) {
    return siteToolError(
      "selection_unavailable",
      settled.readiness.unavailableMessage
    );
  }
  if (settled.readiness.priceError) {
    return siteToolError(
      "price_unavailable",
      m.reservationAdvertisedPriceError({}, { locale: settled.locale })
    );
  }

  const marketingConsentSource = giveRequestedMarketingConsent(
    settled,
    requestsMarketingConsent
  );
  const marketingConsent = getMarketingConsentOutcome(settled);
  const submission = yield* Effect.promise(() =>
    settled.submit(marketingConsentSource)
  );
  return toPrepareReservationResult({
    locale: settled.locale,
    marketingConsent,
    submission,
    summary,
  });
});

/**
 * Ticks the form's own checkbox when the customer asked for marketing
 * communication and the form asks for it. A box the customer ticked stays
 * theirs: the tool never unticks it and labels only its own consent.
 */
const giveRequestedMarketingConsent = (
  form: SiteToolReservationForm,
  requestsMarketingConsent: boolean
) => {
  if (
    !requestsMarketingConsent ||
    !form.asksMarketingConsent ||
    form.hasMarketingConsent()
  ) {
    return undefined;
  }
  form.giveMarketingConsent();
  return "site_tool" as const;
};

/** What the submission says about marketing consent; `submitted` isn't a row change. */
const getMarketingConsentOutcome = (
  form: SiteToolReservationForm
): MarketingConsentOutcome => {
  if (!form.asksMarketingConsent) return "already_granted";
  return form.hasMarketingConsent() ? "submitted" : "not_submitted";
};

const awaitFormReadiness = Effect.fnUntraced(
  function* (form: SiteToolReservationFormHandle, changed: boolean) {
    // A changed selection renders as pending before it settles.
    if (changed) yield* nextCommit(form);
    while (form.current().readiness.isPending) yield* nextCommit(form);
  },
  Effect.timeoutOption(formReadinessTimeout),
  Effect.map(Option.isSome)
);

const nextCommit = (form: SiteToolReservationFormHandle) =>
  Effect.callback<void>((resume) => {
    const stop = form.onNextCommit(() => resume(Effect.void));
    return Effect.sync(stop);
  });

const toPrepareReservationResult = ({
  locale,
  marketingConsent,
  submission,
  summary,
}: {
  readonly locale: Locale;
  readonly marketingConsent: MarketingConsentOutcome;
  readonly submission: ReservationFormSubmission;
  readonly summary: Omit<Quote, "reservation_url">;
}) => {
  switch (submission.status) {
    case "ready":
    case "pricing_changed":
      return {
        status: submission.status,
        pay_url: new URL(submission.redirectUrl, window.location.origin).href,
        expires_at: submission.expiresAt,
        summary,
        marketingConsent,
      };
    case "error":
      return siteToolError("checkout_failed", submission.message);
    case "invalid": {
      const { fields } = submission;
      return fields.every(({ name }) =>
        contactFieldRoots.has(name.split(".")[0] ?? name)
      )
        ? siteToolError(
            "contact_details_required",
            m.siteToolContactDetailsRequired({}, { locale }),
            { missing_fields: fields.map(({ name }) => name) }
          )
        : siteToolError(
            "invalid_selection",
            fields.find(({ message }) => message)?.message ??
              m.reservationErrorMessage({}, { locale }),
            { fields }
          );
    }
  }
};

/** A typed tool error in the shape `/api/mcp` tools return. */
const siteToolError = (
  code: string,
  message: string,
  details: {
    readonly missing_fields?: readonly string[];
    readonly fields?: readonly InvalidFormField[];
  } = {}
) => ({ error: { code, message, ...details } });
