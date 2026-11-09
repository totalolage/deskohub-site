/** The slide after `index`, wrapping from the last slide to the first. */
export const nextSlideIndex = (index: number, slideCount: number) =>
  (index + 1) % slideCount;

/** The slide before `index`, wrapping from the first slide to the last. */
export const previousSlideIndex = (index: number, slideCount: number) =>
  (index - 1 + slideCount) % slideCount;
