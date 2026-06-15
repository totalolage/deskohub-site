import type { Table } from "@deskohub/dotypos/generated";
import { Option, Schema } from "effect";

const DotyposAssignableTableIdSchema = Schema.transform(
  Schema.String,
  Schema.NonEmptyString,
  {
    strict: true,
    decode: (id) => id.trim(),
    encode: (id) => id,
  }
);

export const getAssignableDotyposTableId = (
  table: Pick<Table, "id">
): string | undefined =>
  Option.getOrUndefined(
    Schema.decodeUnknownOption(DotyposAssignableTableIdSchema)(table.id)
  );
