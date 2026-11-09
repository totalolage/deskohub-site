import { Data, Duration, Effect, Option, Schema } from "effect";
import { type Locale, m } from "@/features/i18n";
import type { ReservationFormSubmission } from "@/features/reservation/components/reservation-checkout-form";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import { runWorkspaceBrowserEffectUntilAbort } from "@/shared/browser/workspace-browser-effect";
import type { InvalidFormField } from "@/shared/utils/form-field-errors";
import {
  AgentToolRequestError,
  callAgentTool,
  type PublishedAgentTool,
} from "./agent-tool-mcp-client";
import {
  prepareReservationToolDescription,
  prepareReservationToolName,
} from "./prepare-reservation-site-tool-description";
import {
  registerSiteTool,
  runSiteToolCall,
  withPageLocale,
} from "./register-site-tools";
import {
  getReservationForm,
  subscribeReservationForm,
} from "./site-tool-catalog";
import type {
  SiteToolReservationForm,
  SiteToolReservationFormHandle,
} from "./use-prepare-reservation-site-tool";
import type { ModelContext } from "./webmcp";

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

const contactFieldRoots = new Set([
  "name",
  "email",
  "emailConfirmation",
  "phone",
  "billing",
]);

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
            options?.signal
          )
        ),
    },
    signal
  ).pipe(
    runWorkspaceBrowserEffectUntilAbort(
      "agent-tools.site-tool.prepare_reservation.register",
      signal
    )
  );

/**
 * Quotes the selection through `get_quote`, which validates it and returns
 * the reservation link, then drives the matching reservation form through its
 * own submit path. Only the literal `true` gives marketing consent.
 */
const prepareReservation = ({
  form,
  input: { marketingConsent, ...selection },
  quoteTool,
}: {
  readonly form: SiteToolReservationFormHandle;
  readonly input: Schema.JsonObject;
  readonly quoteTool: PublishedAgentTool;
}) =>
  callAgentTool(
    quoteTool.name,
    withPageLocale(quoteTool, selection, form.current().locale)
  ).pipe(
    // A quote's typed error is the tool's result as it stands.
    Effect.filterOrFail(
      isQuoted,
      ({ structuredContent }) =>
        new PreparationStopped({ result: structuredContent })
    ),
    Effect.flatMap(({ structuredContent }) =>
      decodeQuote(structuredContent).pipe(
        Effect.mapError((cause) => new AgentToolRequestError({ cause }))
      )
    ),
    Effect.flatMap((quote) =>
      prepareQuotedReservation({
        form,
        quote,
        requestsMarketingConsent: marketingConsent === true,
      })
    ),
    Effect.catchTag("PreparationStopped", ({ result }) =>
      Effect.succeed(result)
    )
  );

type AgentToolCall = Effect.Success<ReturnType<typeof callAgentTool>>;

const isQuoted = (
  call: AgentToolCall
): call is Exclude<AgentToolCall, { readonly isError: true }> =>
  call.isError !== true;

/** A stage ended the preparation early with the result the agent gets. */
class PreparationStopped extends Data.TaggedError("PreparationStopped")<{
  readonly result: unknown;
}> {}

const decodeQuote = Schema.decodeUnknownEffect(quoteSchema, {
  onExcessProperty: "preserve",
});

type PreparationRequest = {
  /** The form on the page the agent called the tool from. */
  readonly form: SiteToolReservationFormHandle;
  readonly quote: Quote;
  readonly requestsMarketingConsent: boolean;
};

const prepareQuotedReservation = (request: PreparationRequest) =>
  Effect.succeed(request).pipe(
    Effect.let("locale", ({ form }) => form.current().locale),
    Effect.let(
      "link",
      ({ quote }) => new URL(quote.reservation_url, window.location.origin)
    ),
    Effect.bind("settled", awaitSettledReservationForm),
    Effect.tap(stopUnlessBookable),
    Effect.bind("marketingConsentSource", giveRequestedMarketingConsent),
    Effect.let("marketingConsent", ({ settled }) =>
      getMarketingConsentOutcome(settled)
    ),
    Effect.bind("submission", ({ marketingConsentSource, settled }) =>
      Effect.promise(() => settled.submit(marketingConsentSource))
    ),
    Effect.map(toPrepareReservationResult)
  );

/**
 * The matching reservation form once the link's selection is on it and its
 * availability and price have settled. A selection in another family opens
 * that family's page and continues on the form mounted there, all within one
 * bounded wait.
 */
const awaitSettledReservationForm = ({
  form,
  link,
  locale,
  quote,
}: PreparationRequest & { readonly link: URL; readonly locale: Locale }) =>
  Effect.sync(() => openReservationPage({ form, link, quote })).pipe(
    Effect.andThen(awaitReservationForm(quote.family)),
    Effect.tap((matching) => settleSelection({ form: matching, link })),
    Effect.map((matching) => matching.current()),
    Effect.timeoutOrElse({
      duration: formReadinessTimeout,
      orElse: () =>
        Effect.fail(
          new PreparationStopped({
            result: siteToolError(
              "form_not_ready",
              m.siteToolFormNotReady({}, { locale })
            ),
          })
        ),
    })
  );

const openReservationPage = ({
  form,
  link,
  quote,
}: Pick<PreparationRequest, "form" | "quote"> & { readonly link: URL }) => {
  const page = form.current();
  if (page.kind !== quote.family) {
    page.openReservationPage(quote.family, link.searchParams);
  }
};

/** The published reservation form for `kind`, waiting until one mounts. */
const awaitReservationForm = (kind: SiteToolReservationForm["kind"]) =>
  Effect.callback<SiteToolReservationFormHandle>((resume) => {
    const resumeWithMatchingForm = () => {
      const form = getReservationForm();
      if (form?.current().kind !== kind) return false;
      resume(Effect.succeed(form));
      return true;
    };
    if (resumeWithMatchingForm()) return;
    const unsubscribe = subscribeReservationForm(() =>
      // A form publishes itself while its page mounts. Drive it only once that
      // commit's effects, including its form state's own mount, have run.
      queueMicrotask(() => {
        if (resumeWithMatchingForm()) unsubscribe();
      })
    );
    return Effect.sync(unsubscribe);
  });

/** Puts the link's selection on the form and waits for it to settle. */
const settleSelection = ({
  form,
  link,
}: {
  readonly form: SiteToolReservationFormHandle;
  readonly link: URL;
}) =>
  Effect.sync(() => form.current().applySelection(link.searchParams)).pipe(
    Effect.flatMap((changed) =>
      awaitReadiness(form).pipe(
        // A changed selection renders as pending before it settles.
        Effect.when(
          Effect.sync(() => changed || form.current().readiness.isPending)
        )
      )
    )
  );

const awaitReadiness = (form: SiteToolReservationFormHandle) =>
  nextCommit(form).pipe(
    Effect.repeat({ while: () => form.current().readiness.isPending })
  );

const nextCommit = (form: SiteToolReservationFormHandle) =>
  Effect.callback<void>((resume) => {
    const stop = form.onNextCommit(() => resume(Effect.void));
    return Effect.sync(stop);
  });

const stopUnlessBookable = ({
  settled,
}: {
  readonly settled: SiteToolReservationForm;
}) =>
  Option.match(getUnbookableResult(settled), {
    onNone: () => Effect.void,
    onSome: (result) => Effect.fail(new PreparationStopped({ result })),
  });

// The submit button stays disabled in both cases, so the tool stops too.
const getUnbookableResult = ({
  locale,
  readiness,
}: SiteToolReservationForm) => {
  if (readiness.unavailableMessage) {
    return Option.some(
      siteToolError("selection_unavailable", readiness.unavailableMessage)
    );
  }
  if (readiness.priceError) {
    return Option.some(
      siteToolError(
        "price_unavailable",
        m.reservationAdvertisedPriceError({}, { locale })
      )
    );
  }
  return Option.none();
};

/**
 * Ticks the form's own checkbox when the customer asked for marketing
 * communication and the form asks for it, and labels that consent as the site
 * tool's, even on a box that was already ticked: the request is the agent's.
 * Without the request, a box the customer ticked stays theirs.
 */
const giveRequestedMarketingConsent = ({
  requestsMarketingConsent,
  settled,
}: {
  readonly requestsMarketingConsent: boolean;
  readonly settled: SiteToolReservationForm;
}) =>
  Effect.sync(() => {
    if (!requestsMarketingConsent || !settled.asksMarketingConsent) {
      return undefined;
    }
    settled.giveMarketingConsent();
    return "site_tool" as const;
  });

/** What the submission says about marketing consent; `submitted` isn't a row change. */
const getMarketingConsentOutcome = (
  form: SiteToolReservationForm
): MarketingConsentOutcome => {
  if (!form.asksMarketingConsent) return "already_granted";
  return form.hasMarketingConsent() ? "submitted" : "not_submitted";
};

const toPrepareReservationResult = ({
  locale,
  marketingConsent,
  quote: { reservation_url: _link, ...summary },
  submission,
}: {
  readonly locale: Locale;
  readonly marketingConsent: MarketingConsentOutcome;
  readonly quote: Quote;
  readonly submission: ReservationFormSubmission;
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
    case "email-verification":
      return siteToolError(
        "email_verification_required",
        m.siteToolEmailVerificationRequired({}, { locale })
      );
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
