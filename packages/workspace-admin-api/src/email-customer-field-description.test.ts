import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { describeEmailCustomerField } from "./email-customer-field-description";

const present = { nullable: false, optional: false };
const describeSchema = (schema: Schema.Top) =>
  describeEmailCustomerField(schema.ast);

describe("describeEmailCustomerField", () => {
  test("describes strings, numbers and booleans as scalars", () => {
    expect(describeSchema(Schema.String)).toEqual({
      ...present,
      kind: "scalar",
      type: "string",
    });
    expect(describeSchema(Schema.Number)).toEqual({
      ...present,
      kind: "scalar",
      type: "number",
    });
    expect(describeSchema(Schema.Boolean)).toEqual({
      ...present,
      kind: "scalar",
      type: "boolean",
    });
  });

  test("describes a literal as a scalar with that single choice", () => {
    expect(describeSchema(Schema.Literal("paid"))).toEqual({
      ...present,
      kind: "scalar",
      type: "string",
      choices: ["paid"],
    });
    expect(describeSchema(Schema.Literal(3))).toEqual({
      ...present,
      kind: "scalar",
      type: "number",
      choices: [3],
    });
    expect(describeSchema(Schema.Literal(false))).toEqual({
      ...present,
      kind: "scalar",
      type: "boolean",
      choices: [false],
    });
    expect(describeSchema(Schema.Literal(5n))).toEqual({
      ...present,
      kind: "unsupported",
    });
  });

  test("describes struct properties as record fields, keeping optional keys", () => {
    const hidden = Symbol("hidden");

    expect(
      describeSchema(
        Schema.Struct({
          name: Schema.String,
          nickname: Schema.optionalKey(Schema.String),
          [hidden]: Schema.String,
        })
      )
    ).toEqual({
      ...present,
      kind: "record",
      fields: {
        name: { ...present, kind: "scalar", type: "string" },
        nickname: {
          nullable: false,
          optional: true,
          kind: "scalar",
          type: "string",
        },
      },
    });
  });

  test("describes homogeneous arrays as lists and tuples as unsupported", () => {
    expect(describeSchema(Schema.Array(Schema.Number))).toEqual({
      ...present,
      kind: "list",
      element: { ...present, kind: "scalar", type: "number" },
    });
    expect(
      describeSchema(Schema.Tuple([Schema.String, Schema.Number]))
    ).toEqual({ ...present, kind: "unsupported" });
  });

  test("describes a suspended schema as its target with the outer optionality", () => {
    const Target = Schema.NullOr(Schema.String);

    expect(
      describeSchema(
        Schema.Struct({
          later: Schema.optionalKey(Schema.suspend(() => Target)),
        })
      )
    ).toMatchObject({
      fields: {
        later: {
          nullable: true,
          optional: true,
          kind: "scalar",
          type: "string",
        },
      },
    });
  });

  test("turns null and undefined union members into presence", () => {
    expect(describeSchema(Schema.NullOr(Schema.Number))).toEqual({
      nullable: true,
      optional: false,
      kind: "scalar",
      type: "number",
    });
    expect(describeSchema(Schema.UndefinedOr(Schema.Boolean))).toEqual({
      nullable: false,
      optional: true,
      kind: "scalar",
      type: "boolean",
    });
    expect(describeSchema(Schema.Union([Schema.Null]))).toEqual({
      nullable: true,
      optional: false,
      kind: "unsupported",
    });
  });

  test("merges literal choices of one scalar type and drops them when any alternative is open", () => {
    expect(describeSchema(Schema.Literals(["asc", "desc", "asc"]))).toEqual({
      ...present,
      kind: "scalar",
      type: "string",
      choices: ["asc", "desc"],
    });
    expect(
      describeSchema(Schema.Union([Schema.Literal("fixed"), Schema.String]))
    ).toEqual({ ...present, kind: "scalar", type: "string" });
  });

  test("merges record alternatives, making fields missing from one optional", () => {
    expect(
      describeSchema(
        Schema.Union([
          Schema.Struct({ id: Schema.String, amount: Schema.Number }),
          Schema.Struct({ id: Schema.NullOr(Schema.String) }),
        ])
      )
    ).toEqual({
      ...present,
      kind: "record",
      fields: {
        id: { nullable: true, optional: false, kind: "scalar", type: "string" },
        amount: {
          nullable: false,
          optional: true,
          kind: "scalar",
          type: "number",
        },
      },
    });
  });

  test("merges list alternatives by element", () => {
    expect(
      describeSchema(
        Schema.Union([
          Schema.Array(Schema.Literal(1)),
          Schema.NullOr(Schema.Array(Schema.Literal(2))),
        ])
      )
    ).toEqual({
      nullable: true,
      optional: false,
      kind: "list",
      element: {
        ...present,
        kind: "scalar",
        type: "number",
        choices: [1, 2],
      },
    });
  });

  test("keeps alternatives of different kinds as a union", () => {
    expect(
      describeSchema(
        Schema.Union([
          Schema.String,
          Schema.Number,
          Schema.Struct({ id: Schema.String }),
        ])
      )
    ).toEqual({
      ...present,
      kind: "union",
      alternatives: [
        { ...present, kind: "scalar", type: "string" },
        { ...present, kind: "scalar", type: "number" },
        {
          ...present,
          kind: "record",
          fields: { id: { ...present, kind: "scalar", type: "string" } },
        },
      ],
    });
  });

  test("describes any other schema as unsupported", () => {
    expect(describeSchema(Schema.Unknown)).toEqual({
      ...present,
      kind: "unsupported",
    });
    expect(describeSchema(Schema.Undefined)).toEqual({
      nullable: false,
      optional: true,
      kind: "unsupported",
    });
  });
});
