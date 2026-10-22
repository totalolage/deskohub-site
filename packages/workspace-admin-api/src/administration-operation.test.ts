import { describe, expect, test } from "bun:test";
import { Context, Option, Schema, SchemaAST } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import {
  AdministrationOperationBehavior,
  AdministrationOperationVariants,
  administrationOperations,
  CliOnly,
  credentialPaths,
  disclosedCredentials,
} from "./administration-operation";
import { campaignOperations } from "./campaign-operations";
import {
  AdministrationAuthentication,
  CliServiceUnavailable,
  CliSessionUnauthorized,
} from "./workspace-admin-api";
import { WorkspaceAdminApi } from "./workspace-admin-http-api";

type ReflectedEndpoint = {
  readonly reference: string;
  readonly group: HttpApiGroup.AnyWithProps;
  readonly endpoint: HttpApiEndpoint.AnyWithProps;
  readonly annotations: Context.Context<never>;
  readonly middleware: ReadonlySet<unknown>;
  readonly outputs: ReadonlyArray<Schema.Top>;
  readonly errors: ReadonlyMap<number, ReadonlyArray<Schema.Top>>;
};

const reflectEndpoints = <Id extends string, Groups extends HttpApiGroup.Any>(
  api: HttpApi.HttpApi<Id, Groups>
) => {
  const endpoints: Array<ReflectedEndpoint> = [];
  HttpApi.reflect(api, {
    onGroup: () => undefined,
    onEndpoint: ({
      group,
      endpoint,
      mergedAnnotations,
      middleware,
      successes,
      errors,
    }) => {
      endpoints.push({
        reference: `${group.identifier}.${endpoint.name}`,
        group,
        endpoint,
        annotations: mergedAnnotations,
        middleware,
        outputs: [...successes.values(), ...errors.values()].flat(),
        errors,
      });
    },
  });
  return endpoints;
};

const endpoints = reflectEndpoints(WorkspaceAdminApi);
const operations = administrationOperations(WorkspaceAdminApi);
const operationByReference = new Map(
  operations.map((operation) => [operation.reference, operation])
);
const isCliOnly = (endpoint: ReflectedEndpoint) =>
  Option.isSome(Context.getOption(endpoint.annotations, CliOnly));

const payloadProperty = (
  endpoint: HttpApiEndpoint.AnyWithProps,
  name: string
) =>
  [...endpoint.payload.values()]
    .flatMap(({ schemas }) => schemas)
    .map((schema) => SchemaAST.toType(schema.ast))
    .filter(SchemaAST.isObjects)
    .flatMap((ast) => ast.propertySignatures)
    .find((property) => property.name === name)?.type;

const literalsOf = (union: SchemaAST.AST, discriminator: string) =>
  (SchemaAST.isUnion(union) ? union.types : [union])
    .filter(SchemaAST.isObjects)
    .flatMap((member) => member.propertySignatures)
    .filter((property) => property.name === discriminator)
    .map((property) => property.type)
    .filter(SchemaAST.isLiteral)
    .map((literal) => String(literal.literal));

describe("administration operations", () => {
  test("every endpoint declares exactly one behavior, variant map or CLI-only reason", () => {
    const undeclared = endpoints
      .filter(
        ({ annotations }) =>
          [
            Context.getOption(annotations, AdministrationOperationBehavior),
            Context.getOption(annotations, AdministrationOperationVariants),
            Context.getOption(annotations, CliOnly),
          ].filter((option) => Option.isSome<unknown>(option)).length !== 1
      )
      .map(({ reference }) => reference);

    expect(undeclared).toEqual([]);
  });

  test("refuses an endpoint that declares neither or both", () => {
    const groupWith = (endpoint: HttpApiEndpoint.Any) =>
      HttpApi.make("test").add(HttpApiGroup.make("test").add(endpoint));
    const bare = groupWith(
      HttpApiEndpoint.get("bare", "/bare", { success: Schema.String })
    );
    const both = groupWith(
      HttpApiEndpoint.get("both", "/both", { success: Schema.String })
        .annotate(AdministrationOperationBehavior, {
          kind: "read",
          idempotent: true,
        })
        .annotate(CliOnly, { reason: "test" })
    );

    expect(() => administrationOperations(bare)).toThrow("test.bare");
    expect(() => administrationOperations(both)).toThrow("test.both");
  });

  test("each variant map names exactly the variants its payload union has", () => {
    const mismatched = endpoints.flatMap(
      ({ reference, endpoint, annotations }) =>
        Option.match(
          Context.getOption(annotations, AdministrationOperationVariants),
          {
            onNone: () => [],
            onSome: ({ field, discriminator, operations }) => {
              const union = payloadProperty(endpoint, field);
              const literals = union ? literalsOf(union, discriminator) : [];
              return literals.length > 0 &&
                [...literals].sort().join() ===
                  Object.keys(operations).sort().join()
                ? []
                : [reference];
            },
          }
        )
    );

    expect(mismatched).toEqual([]);
  });

  test("only destructive operations declare a preview, and each preview exists", () => {
    const invalid = operations.flatMap((operation) => {
      if (operation.access._tag !== "Operation") {
        return [];
      }
      const { kind, preview } = operation.access.behavior;
      if (preview === undefined) {
        return [];
      }
      if (kind !== "destructive") {
        return [`${operation.reference}: preview on a ${kind} operation`];
      }
      if (preview._tag === "DryRun") {
        const endpoint = endpoints.find(
          ({ reference }) =>
            reference === `${operation.group}.${operation.endpoint}`
        );
        return endpoint && payloadProperty(endpoint.endpoint, "dryRun")
          ? []
          : [`${operation.reference}: dry-run preview without dryRun`];
      }
      return preview.operations.flatMap((reference) => {
        const target = operationByReference.get(reference);
        return target?.access._tag === "Operation" &&
          target.access.behavior.kind === "read"
          ? []
          : [`${operation.reference}: ${reference} isn't a read operation`];
      });
    });

    expect(invalid).toEqual([]);
  });

  test("CLI-only endpoints alone use the CLI's own authentication", () => {
    const misplaced = endpoints
      .filter(
        (endpoint) =>
          endpoint.middleware.has(AdministrationAuthentication) ===
          isCliOnly(endpoint)
      )
      .map(({ reference }) => reference);

    expect(misplaced).toEqual([]);
  });

  test("operations keep the authentication errors released dhw decodes", () => {
    const changed = endpoints
      .filter((endpoint) => !isCliOnly(endpoint))
      .filter(
        ({ errors }) =>
          !errors.get(401)?.includes(CliSessionUnauthorized.schema) ||
          !errors.get(503)?.includes(CliServiceUnavailable.schema)
      )
      .map(({ reference }) => reference);

    expect(changed).toEqual([]);
  });

  test("campaign port queries are the read endpoints, and ledger writes are idempotent", () => {
    const inconsistent = Object.values(campaignOperations).flatMap(
      (operation) => {
        const reference = operations.find(
          ({ endpoint }) => endpoint === operation.name
        );
        if (reference?.access._tag !== "Operation") {
          return [operation.name];
        }
        const { kind, idempotent } = reference.access.behavior;
        return (operation.kind === "query") === (kind === "read") &&
          (!operation.ledger || idempotent)
          ? []
          : [operation.name];
      }
    );

    expect(inconsistent).toEqual([]);
  });
});

describe("credentials in operation outputs", () => {
  test("only CLI-only endpoints and the allowlisted disclosures return one", () => {
    const leaks = endpoints
      .filter((endpoint) => !isCliOnly(endpoint))
      .flatMap(({ reference, outputs }) =>
        outputs.flatMap(credentialPaths).map((path) => ({
          operation: reference,
          path,
        }))
      );

    expect(leaks).toEqual(
      disclosedCredentials.map(({ operation, path }) => ({ operation, path }))
    );
  });

  test("the CLI sign-in hands out its credentials", () => {
    const handedOut = endpoints
      .filter(isCliOnly)
      .filter(({ outputs }) =>
        outputs.some((schema) => credentialPaths(schema).length > 0)
      )
      .map(({ reference }) => reference);

    expect(handedOut).toEqual([
      "cli.startAuthentication",
      "cli.getAuthenticationStatus",
      "cli.exchangeGrant",
    ]);
  });

  test("finds a mark behind later checks, nesting and unions", () => {
    const Token = Schema.String.annotate({ credential: true }).check(
      Schema.isMinLength(1)
    );
    const schema = Schema.Struct({
      safe: Schema.String,
      nested: Schema.Struct({ token: Schema.NullOr(Token) }),
      list: Schema.Array(Schema.Union([Schema.Number, Token])),
    });

    expect(credentialPaths(schema)).toEqual([
      ["nested", "token"],
      ["list", "*"],
    ]);
  });
});
