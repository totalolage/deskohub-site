import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { standaloneAccessCodeAttemptEvents } from "./standalone-access-code-attempt-events";

describe("standalone access-code attempt event audit schema", () => {
  test("stores safe metadata only without any PIN or payload column", () => {
    const config = getTableConfig(standaloneAccessCodeAttemptEvents);
    for (const column of config.columns) {
      expect(column.name).not.toMatch(/pin|secret|payload|access_code/);
      expect(column.columnType).not.toBe("JSONB");
    }
  });
});
