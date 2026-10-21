import { join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import type { BunPlugin } from "bun";
import postcss from "postcss";

const widgetDirectory = import.meta.dir;

/** Where `booking-widget:build` writes the view; `show_booking` serves it. */
const outputPath = join(widgetDirectory, "generated/booking-widget.html");

/** Compiles the widget stylesheet with Tailwind, which Bun's bundler doesn't run. */
const tailwindStylesheet: BunPlugin = {
  name: "booking-widget-tailwind",
  setup(build) {
    build.onLoad({ filter: /booking-widget\.css$/ }, async ({ path }) => ({
      contents: (
        await postcss([tailwindcss({ optimize: { minify: true } })]).process(
          await Bun.file(path).text(),
          { from: path }
        )
      ).css,
      loader: "css",
    }));
  },
};

/**
 * The Preact modules that stand in for React's: react-dom alone would be a
 * third of the document. The shared UI primitives and Effect Atom use only
 * APIs that `preact/compat` provides.
 */
const preactModules: Readonly<Record<string, string>> = {
  react: import.meta.resolve("preact/compat"),
  "react-dom": import.meta.resolve("preact/compat"),
  "react-dom/client": import.meta.resolve("preact/compat/client"),
  "react/jsx-runtime": import.meta.resolve("preact/compat/jsx-runtime"),
};

/** Renders the view with Preact; any other React module fails the build. */
const preactCompat: BunPlugin = {
  name: "booking-widget-preact",
  setup(build) {
    build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, ({ path }) => {
      const module = preactModules[path];
      if (module === undefined) {
        throw new Error(`The booking view has no Preact module for ${path}.`);
      }
      return { path: fileURLToPath(module) };
    });
  },
};

/**
 * Bundles the booking view into one self-contained HTML document: its
 * script, styles, and copy inlined, rendered with Preact. Hosts
 * render it in a sandbox that loads nothing from other origins.
 */
export const buildBookingWidget = async () => {
  const build = await Bun.build({
    entrypoints: [join(widgetDirectory, "index.html")],
    compile: true,
    target: "browser",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [tailwindStylesheet, preactCompat],
  });
  const [document] = build.outputs;
  if (!build.success || document === undefined) {
    throw new AggregateError(build.logs, "The booking view didn't build.");
  }
  return document.text();
};

if (import.meta.main) {
  await Bun.write(outputPath, await buildBookingWidget());
}
