import { type DotyposTableId, DotyposTableIdSchema } from "@deskohub/dotypos";
import type { Table } from "@deskohub/dotypos/generated";
import { Option, Schema } from "effect";

export const getAssignableDotyposTableId = (
  table: Pick<Table, "id">
): DotyposTableId | undefined =>
  Option.getOrUndefined(
    Schema.decodeUnknownOption(DotyposTableIdSchema)(table.id?.trim())
  );
