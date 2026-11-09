import { describe, expect, test } from "bun:test";
import { automationRunEventDetails } from "@deskohub/workspace-admin-api";
import type { SchemaAST } from "effect";

/** Each stored field's path with the kind of value it can hold. */
const storedFields = (
  ast: SchemaAST.AST,
  path = ""
): Readonly<Record<string, string>> => {
  if (ast._tag === "Objects") {
    return Object.assign(
      {},
      ...ast.propertySignatures.map((property) =>
        storedFields(property.type, `${path}.${String(property.name)}`)
      )
    );
  }
  if (ast._tag === "Arrays") {
    return Object.assign(
      {},
      ...ast.rest.map((element) => storedFields(element, `${path}[]`))
    );
  }
  return { [path]: valueKind(ast) };
};

const valueKind = (ast: SchemaAST.AST): string => {
  if (ast._tag === "Literal") return JSON.stringify(ast.literal);
  if (ast._tag === "Union") return ast.types.map(valueKind).join(" | ");
  return ast._tag;
};

describe("timeline entry details", () => {
  // Entries are written into preview branches with the production rows, so
  // they record decisions only (§1.5): clause indices, saved-audience ids
  // with definition hashes, reason codes, a send id and instants. A new
  // field fails this pin until it is reviewed; none may hold a tag, a
  // discount group, an email, a digest or any other customer fact.
  test("store exactly the decision fields of each kind", () => {
    expect(
      Object.fromEntries(
        Object.entries(automationRunEventDetails).map(([kind, schema]) => [
          kind,
          storedFields(schema.ast),
        ])
      )
    ).toEqual({
      started: {},
      "condition-passed": {},
      "condition-failed": {
        ".failedConditions[]": "Number",
        ".savedAudiences[].audienceId": "String",
        ".savedAudiences[].filterHash": "String",
      },
      waiting: { ".dueAt": "String" },
      woke: {},
      deferred: {
        ".cause": '"trigger-not-reached"',
        ".recheckAt": "String",
      },
      "send-queued": { ".sendId": "String" },
      sent: {},
      unconfirmed: {},
      skipped: {
        ".reason":
          '"missing-from-dotypos" | "deleted-customer" | "missing-email" | "invalid-email" | "consent-withdrawn" | "outside-test-domain"',
      },
      failed: { ".reason": '"delivery-refused" | "evaluation-unavailable"' },
      withdrawn: {},
      archived: {},
    });
  });
});
