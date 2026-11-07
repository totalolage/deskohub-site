import { describe, expect, test } from "bun:test";
import { i18nSmokeCases } from "./i18n-smoke-cases";

describe("i18nSmokeCases", () => {
  test.each(i18nSmokeCases.map((smokeCase) => [smokeCase.name, smokeCase]))(
    "%s passes on Bun",
    (_name, smokeCase) => {
      expect(() => smokeCase.run()).not.toThrow();
    }
  );
});
