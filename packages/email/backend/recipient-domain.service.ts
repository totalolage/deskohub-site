import { Resolver } from "node:dns/promises";
import { domainToASCII } from "node:url";
import {
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Result,
  Schema,
} from "effect";
import { isTestEmailRecipient } from "./test-recipients";

/**
 * Whether a recipient address's domain can receive mail. `rejects_mail` is
 * returned only for a definitive DNS answer; resolver failures and timeouts
 * are `unknown`, so callers can fail open.
 */
export type EmailRecipientDomainStatus =
  | "accepts_mail"
  | "rejects_mail"
  | "unknown";

export type MailDomainRecordType = "MX" | "A" | "AAAA";

/**
 * DNS records a mail domain publishes. MX lookups return exchange host names;
 * an empty or "." exchange is a null MX (RFC 7505).
 */
export interface IMailDomainDns {
  readonly resolve: (
    domain: string,
    type: MailDomainRecordType
  ) => Effect.Effect<readonly string[], DnsLookupError>;
}

export class MailDomainDns extends Context.Service<
  MailDomainDns,
  IMailDomainDns
>()("MailDomainDns") {
  static Live = Layer.sync(this, makeNodeMailDomainDns);
}

export class DnsLookupError extends Data.TaggedError("DnsLookupError")<{
  /** Resolver error code such as `ENOTFOUND` (NXDOMAIN) or `ENODATA`. */
  readonly code?: string;
  readonly cause?: unknown;
}> {}

export interface IEmailRecipientDomainService {
  readonly check: (
    address: string
  ) => Effect.Effect<EmailRecipientDomainStatus>;
}

export class EmailRecipientDomainService extends Context.Service<
  EmailRecipientDomainService,
  IEmailRecipientDomainService
>()("EmailRecipientDomainService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const dns = yield* MailDomainDns;

      return {
        check: Effect.fn("EmailRecipientDomainService.check")(function* (
          address: string
        ) {
          // Test recipients are logged by Console and never sent, so their
          // reserved domain needs no mail server.
          if (isTestEmailRecipient(address)) return "accepts_mail" as const;

          const domain = getAsciiDomain(address);
          if (!domain) return "unknown" as const;

          return yield* checkDomain(dns, domain).pipe(
            Effect.timeoutOrElse({
              duration: checkTimeout,
              orElse: () => Effect.succeed("unknown" as const),
            })
          );
        }),
      };
    })
  );

  static Live = this.Default.pipe(Layer.provide(MailDomainDns.Live));
}

const checkTimeout = Duration.seconds(4);
const lookupTimeoutMilliseconds = 1500;

/**
 * Resolver codes for a definite negative answer: the domain does not exist,
 * or it exists without a record of the requested type.
 */
const DnsNegativeAnswerSchema = Schema.Struct({
  code: Schema.Literals(["ENOTFOUND", "ENODATA"]),
});
const decodeNegativeAnswer = Schema.decodeUnknownOption(
  DnsNegativeAnswerSchema
);

/**
 * What one DNS lookup established: usable records, an answer without usable
 * records (including a null MX), a missing record type, a missing domain, or
 * no definite answer.
 */
type RecordLookup = "found" | "empty" | "no_records" | "no_domain" | "unknown";

/**
 * RFC 5321 section 5.1: deliver to the MX hosts, or to the domain's own
 * address when it publishes no MX records.
 */
const checkDomain = Effect.fn("EmailRecipientDomainService.checkDomain")(
  function* (dns: IMailDomainDns, domain: string) {
    const exchanges = yield* lookupRecords(dns, domain, "MX", isMailExchange);

    return yield* Match.value(exchanges).pipe(
      Match.when("found", () => Effect.succeed("accepts_mail" as const)),
      // A null MX declines mail; a missing domain cannot receive it.
      Match.whenOr("empty", "no_domain", () =>
        Effect.succeed("rejects_mail" as const)
      ),
      Match.when("unknown", () => Effect.succeed("unknown" as const)),
      Match.when("no_records", () => checkDomainAddress(dns, domain)),
      Match.exhaustive
    );
  }
);

const checkDomainAddress = Effect.fn(
  "EmailRecipientDomainService.checkDomainAddress"
)(function* (dns: IMailDomainDns, domain: string) {
  const statuses = (yield* Effect.all(
    [lookupRecords(dns, domain, "A"), lookupRecords(dns, domain, "AAAA")],
    { concurrency: "inherit" }
  )).map(toAddressStatus);

  if (statuses.includes("accepts_mail")) return "accepts_mail" as const;
  return statuses.includes("unknown")
    ? ("unknown" as const)
    : ("rejects_mail" as const);
});

const lookupRecords = (
  dns: IMailDomainDns,
  domain: string,
  type: MailDomainRecordType,
  /** Narrows which records count; without it, any returned record does. */
  isUsable?: (record: string) => boolean
): Effect.Effect<RecordLookup> =>
  dns.resolve(domain, type).pipe(
    Effect.result,
    Effect.map(
      Result.match({
        onSuccess: (records): RecordLookup =>
          (isUsable ? records.some(isUsable) : records.length > 0)
            ? "found"
            : "empty",
        onFailure: (error): RecordLookup =>
          decodeNegativeAnswer(error).pipe(
            Option.map(({ code }) =>
              Match.value(code).pipe(
                Match.when("ENOTFOUND", () => "no_domain" as const),
                Match.when("ENODATA", () => "no_records" as const),
                Match.exhaustive
              )
            ),
            Option.getOrElse(() => "unknown" as const)
          ),
      })
    )
  );

const toAddressStatus = Match.type<RecordLookup>().pipe(
  Match.when("found", () => "accepts_mail" as const),
  Match.whenOr(
    "empty",
    "no_records",
    "no_domain",
    () => "rejects_mail" as const
  ),
  Match.when("unknown", () => "unknown" as const),
  Match.exhaustive
);

const isMailExchange = (exchange: string) =>
  exchange !== "" && exchange !== ".";

const getAsciiDomain = (address: string) => {
  const separator = address.lastIndexOf("@");
  if (separator < 0) return undefined;

  const domain = address
    .slice(separator + 1)
    .trim()
    .replace(/\.$/, "");
  return domain ? domainToASCII(domain) || undefined : undefined;
};

function makeNodeMailDomainDns(): IMailDomainDns {
  return {
    resolve: (domain, type) =>
      Effect.tryPromise({
        try: async (signal) => {
          const resolver = new Resolver({
            timeout: lookupTimeoutMilliseconds,
            tries: 2,
          });
          signal.addEventListener("abort", () => resolver.cancel(), {
            once: true,
          });

          switch (type) {
            case "MX":
              return (await resolver.resolveMx(domain)).map(
                (record) => record.exchange
              );
            case "A":
              return await resolver.resolve4(domain);
            case "AAAA":
              return await resolver.resolve6(domain);
          }
        },
        catch: (cause) =>
          new DnsLookupError({
            code: getErrorCode(cause),
            cause,
          }),
      }),
  };
}

/** Node resolver errors carry their c-ares status as a string `code`. */
const decodeResolverError = Schema.decodeUnknownOption(
  Schema.Struct({ code: Schema.String })
);

const getErrorCode = (cause: unknown) =>
  Option.getOrUndefined(
    Option.map(decodeResolverError(cause), ({ code }) => code)
  );
