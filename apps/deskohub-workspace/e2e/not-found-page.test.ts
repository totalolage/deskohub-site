import { expect, test } from "bun:test";
import { isNotFoundPage } from "./not-found-page";

test("recognizes a not-found boundary streamed after the shell", () => {
  expect(
    isNotFoundPage(
      '<meta name="robots" content="noindex"/><template data-dgst="NEXT_HTTP_ERROR_FALLBACK;404"></template>'
    )
  ).toBe(true);
});

test("recognizes Next's default not-found page", () => {
  expect(isNotFoundPage('<h1 class="next-error-h1">404</h1>')).toBe(true);
});

test("does not mistake a streamed server error for a not-found page", () => {
  expect(
    isNotFoundPage(
      '<template data-dgst="2871029386"></template><h1 class="next-error-h1">500</h1>'
    )
  ).toBe(false);
});

test("does not mistake a page's serialized not-found boundary for a not-found page", () => {
  expect(
    isNotFoundPage(
      '<main>Reservation</main><script>self.__next_f.push([1,"[\\"$\\",\\"main\\",null,{\\"children\\":\\"404\\"}]"])</script>'
    )
  ).toBe(false);
});
