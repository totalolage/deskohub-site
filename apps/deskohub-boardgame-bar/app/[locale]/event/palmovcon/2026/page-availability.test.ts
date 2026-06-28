import { expect, test } from "bun:test";
import {
  isPalmovconPageExpired,
  PALMOVCON_PAGE_EXPIRES_AT,
} from "./page-availability";

test("keeps the Palmovcon page visible through the final festival day", () => {
  expect(isPalmovconPageExpired(PALMOVCON_PAGE_EXPIRES_AT - 1)).toBeFalse();
});

test("expires the Palmovcon page at Prague midnight after the festival", () => {
  expect(isPalmovconPageExpired(PALMOVCON_PAGE_EXPIRES_AT)).toBeTrue();
});
