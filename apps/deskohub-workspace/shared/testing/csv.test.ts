import { describe, expect, test } from "bun:test";
import { serializeCsv } from "@/shared/utils/csv";
import { parseCsv } from "./csv.test-utils";

const cells = [
  "a,b",
  'say "hi"',
  "line\nbreak",
  "both\r\nends",
  "",
  "Žluťoučký",
];
const columns = cells.map((_, index) => ({
  header: `Column ${index}`,
  value: (row: readonly string[]) => row[index],
}));

describe("parseCsv", () => {
  test("reads back every cell the serializer writes", () => {
    expect(parseCsv(serializeCsv(columns, [cells, cells]))).toEqual([
      columns.map(({ header }) => header),
      cells,
      cells,
    ]);
  });

  test("drops a leading byte order mark", () => {
    const byteOrderMark = String.fromCodePoint(0xfe_ff);

    expect(
      parseCsv(`${byteOrderMark}${serializeCsv(columns, [cells])}`)
    ).toEqual([columns.map(({ header }) => header), cells]);
  });

  test("refuses text that ends inside a quoted cell", () => {
    expect(() => parseCsv('"open')).toThrow();
  });
});
