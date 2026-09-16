import { expect, test } from "@playwright/test";
import { getWorkspaceE2EMarketingDocumentHash } from "./marketing-document-hash";

const expectedProductionHash =
  "75655dda4406b51fd74d1151a8d28443b75e580728c203cef54c2483ec3ed02d";
// The degraded digest produced when Playwright's JSX stub objects are
// canonicalized without normalization (three JSX-bearing bodies vanish).
const stubDegradedHash =
  "ed3f0b7fea3fb35687e8299001d829aa4386003ae7abf7e7b047adbb9f21ad2e";

test("marketing communications document hash matches production", () => {
  const hash = getWorkspaceE2EMarketingDocumentHash();
  expect(hash).toBe(expectedProductionHash);
  expect(hash).not.toBe(stubDegradedHash);
});
