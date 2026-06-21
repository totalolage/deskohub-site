import type { Table } from "@deskohub/dotypos/generated";

export const getAssignableDotyposTableId = (
  table: Pick<Table, "id">
): string | undefined => table.id?.trim() || undefined;
