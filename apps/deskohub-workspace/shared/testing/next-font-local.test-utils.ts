/**
 * A `next/font/local` stand-in for `mock.module("next/font/local")`: outside
 * a Next.js build a font's family list is its quoted source path, and its
 * variable is the one it names. Every test file that loads fonts uses this
 * one, because Bun shares a module mock across the files of a run.
 */
export const nextFontLocal = {
  default: ({ src, variable }: { src: string; variable?: string }) => ({
    variable,
    style: { fontFamily: `'${src}'` },
  }),
};
