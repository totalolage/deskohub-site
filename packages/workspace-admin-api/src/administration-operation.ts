import {
  type Array as Arr,
  Context,
  Option,
  type Schema,
  SchemaAST,
} from "effect";
import { HttpApi, type HttpApiGroup } from "effect/unstable/httpapi";

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      /**
       * Marks a value that lets its holder act, such as a token or a PIN.
       * Only CLI-only operations and the allowlisted disclosures in
       * `disclosedCredentials` may return one.
       */
      readonly credential?: true | undefined;
    }
  }
}

/**
 * What an administration operation does: `read` changes nothing, `write`
 * changes state an administrator can undo or redo, and `destructive` cancels,
 * sends, deletes, revokes, or grants something an administrator should
 * confirm first. `dhw` confirms every destructive operation before it runs.
 */
export type AdministrationOperationKind = "read" | "write" | "destructive";

/** `<group>.<endpoint>`, plus `.<variant>` for a generic mutation variant. */
export type AdministrationOperationReference = `${string}.${string}`;

/**
 * How a caller shows what a destructive operation would change before it
 * runs: the same endpoint with `dryRun: true`, or read operations that show
 * the current state.
 */
export type AdministrationOperationPreview =
  | { readonly _tag: "DryRun" }
  | {
      readonly _tag: "Read";
      readonly operations: Arr.NonEmptyReadonlyArray<AdministrationOperationReference>;
    };

/**
 * An endpoint annotation describing what its operation does, so every
 * channel can tell reads from changes and confirm destructive ones.
 */
export class AdministrationOperationBehavior extends Context.Service<
  AdministrationOperationBehavior,
  {
    readonly kind: AdministrationOperationKind;
    /** Repeating the same input, request ID included, has no further effect. */
    readonly idempotent: boolean;
    readonly preview?: AdministrationOperationPreview | undefined;
  }
>()("@deskohub/workspace-admin-api/AdministrationOperationBehavior") {}

/**
 * An endpoint annotation for a generic mutation endpoint: its payload's
 * `field` is a union whose members are separate operations, told apart by
 * their `discriminator` literal.
 */
export class AdministrationOperationVariants extends Context.Service<
  AdministrationOperationVariants,
  {
    readonly field: string;
    readonly discriminator: string;
    readonly operations: Readonly<
      Record<string, AdministrationOperationBehavior["Service"]>
    >;
  }
>()("@deskohub/workspace-admin-api/AdministrationOperationVariants") {}

/**
 * An endpoint annotation for the CLI's own transport: its sign-in handshake
 * and client checks. These aren't administration operations and no other
 * channel serves them.
 */
export class CliOnly extends Context.Service<
  CliOnly,
  { readonly reason: string }
>()("@deskohub/workspace-admin-api/CliOnly") {}

export const readOperation: AdministrationOperationBehavior["Service"] = {
  kind: "read",
  idempotent: true,
};

export const writeOperation = (options: {
  readonly idempotent: boolean;
}): AdministrationOperationBehavior["Service"] => ({
  kind: "write",
  ...options,
});

export const destructiveOperation = (options: {
  readonly idempotent: boolean;
  readonly preview?: AdministrationOperationPreview;
}): AdministrationOperationBehavior["Service"] => ({
  kind: "destructive",
  ...options,
});

export const dryRunPreview: AdministrationOperationPreview = { _tag: "DryRun" };

export const readPreview = (
  ...operations: Arr.NonEmptyReadonlyArray<AdministrationOperationReference>
): AdministrationOperationPreview => ({ _tag: "Read", operations });

/**
 * The credentials an operation may return to any administration channel.
 * The standalone access-code PIN is shown once, to the administrator who
 * created it, and is never stored for later display.
 */
export const disclosedCredentials: ReadonlyArray<{
  readonly operation: AdministrationOperationReference;
  readonly path: ReadonlyArray<string>;
}> = [
  {
    operation: "administration.createStandaloneAccessCode",
    path: ["pin"],
  },
];

const isCredentialCheck = (check: SchemaAST.Check<unknown>): boolean =>
  check.annotations?.credential === true ||
  (check._tag === "FilterGroup" && check.checks.some(isCredentialCheck));

/**
 * The mark can sit on the node or on any of its checks: annotating a checked
 * schema stores it on the last check, and a later `.check` appends another.
 */
const isCredential = (ast: SchemaAST.AST) =>
  ast.annotations?.credential === true ||
  (ast.checks?.some(isCredentialCheck) ?? false);

/** The property paths at which a value of the schema can hold a credential. */
export const credentialPaths = (
  schema: Schema.Top
): ReadonlyArray<ReadonlyArray<string>> => {
  const paths: Array<ReadonlyArray<string>> = [];
  const visit = (
    ast: SchemaAST.AST,
    path: ReadonlyArray<string>,
    ancestors: ReadonlySet<SchemaAST.AST>
  ): void => {
    // A recursive schema reaches itself again; its paths are already covered.
    if (ancestors.has(ast)) {
      return;
    }
    const within = new Set(ancestors).add(ast);
    if (isCredential(ast)) {
      paths.push(path);
      return;
    }
    for (const link of ast.encoding ?? []) {
      visit(link.to, path, within);
    }
    if (SchemaAST.isObjects(ast)) {
      for (const property of ast.propertySignatures) {
        visit(property.type, [...path, String(property.name)], within);
      }
      for (const index of ast.indexSignatures) {
        visit(index.type, [...path, "*"], within);
      }
    } else if (SchemaAST.isArrays(ast)) {
      for (const element of [...ast.elements, ...ast.rest]) {
        visit(element, [...path, "*"], within);
      }
    } else if (SchemaAST.isUnion(ast)) {
      for (const member of ast.types) {
        visit(member, path, within);
      }
    } else if (SchemaAST.isSuspend(ast)) {
      visit(ast.thunk(), path, within);
    } else if (SchemaAST.isDeclaration(ast)) {
      for (const parameter of ast.typeParameters) {
        visit(parameter, path, within);
      }
    }
  };
  visit(schema.ast, [], new Set());
  return paths.filter(
    (path, index) =>
      paths.findIndex((other) => other.join(".") === path.join(".")) === index
  );
};

/** How one endpoint, or one variant of a generic mutation endpoint, is served. */
export type AdministrationOperationAccess =
  | {
      readonly _tag: "Operation";
      readonly behavior: AdministrationOperationBehavior["Service"];
    }
  | { readonly _tag: "CliOnly"; readonly reason: string };

export interface AdministrationOperationEntry {
  readonly reference: AdministrationOperationReference;
  readonly group: string;
  readonly endpoint: string;
  readonly variant: Option.Option<string>;
  readonly access: AdministrationOperationAccess;
}

/**
 * Every operation of the API, one entry per endpoint and one per generic
 * mutation variant. Fails on an endpoint that doesn't declare exactly one of
 * `AdministrationOperationBehavior`, `AdministrationOperationVariants` and `CliOnly`.
 */
export const administrationOperations = <
  Id extends string,
  Groups extends HttpApiGroup.Any,
>(
  api: HttpApi.HttpApi<Id, Groups>
): ReadonlyArray<AdministrationOperationEntry> => {
  const entries: Array<AdministrationOperationEntry> = [];
  HttpApi.reflect(api, {
    onGroup: () => undefined,
    onEndpoint: ({ group, endpoint, mergedAnnotations }) => {
      const reference: AdministrationOperationReference = `${group.identifier}.${endpoint.name}`;
      const operation = Context.getOption(
        mergedAnnotations,
        AdministrationOperationBehavior
      );
      const variants = Context.getOption(
        mergedAnnotations,
        AdministrationOperationVariants
      );
      const cliOnly = Context.getOption(mergedAnnotations, CliOnly);
      const declared = [operation, variants, cliOnly].filter((option) =>
        Option.isSome<unknown>(option)
      ).length;
      if (declared !== 1) {
        throw new Error(
          `${reference} must declare exactly one of AdministrationOperationBehavior, AdministrationOperationVariants and CliOnly.`
        );
      }
      const base = {
        group: group.identifier,
        endpoint: endpoint.name,
      };
      if (Option.isSome(operation)) {
        entries.push({
          ...base,
          reference,
          variant: Option.none(),
          access: { _tag: "Operation", behavior: operation.value },
        });
      } else if (Option.isSome(variants)) {
        for (const [variant, behavior] of Object.entries(
          variants.value.operations
        )) {
          entries.push({
            ...base,
            reference: `${reference}.${variant}`,
            variant: Option.some(variant),
            access: { _tag: "Operation", behavior },
          });
        }
      } else if (Option.isSome(cliOnly)) {
        entries.push({
          ...base,
          reference,
          variant: Option.none(),
          access: { _tag: "CliOnly", reason: cliOnly.value.reason },
        });
      }
    },
  });
  return entries;
};
