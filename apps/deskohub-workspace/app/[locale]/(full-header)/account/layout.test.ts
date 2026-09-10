import { describe, expect, test } from "bun:test";

const layoutSource = await Bun.file(
  new URL("./layout.tsx", import.meta.url)
).text();

describe("account route layout", () => {
  test("only composes account content with its modal slot", () => {
    expect(layoutSource).toContain("readonly children: ReactNode");
    expect(layoutSource).toContain("readonly modal: ReactNode");
    expect(layoutSource).toContain("{children}");
    expect(layoutSource).toContain("{modal}");
    expect(layoutSource).not.toContain("CustomerAuthentication");
    expect(layoutSource).not.toContain("connection()");
    expect(layoutSource).not.toContain("prefetch");
  });
});
