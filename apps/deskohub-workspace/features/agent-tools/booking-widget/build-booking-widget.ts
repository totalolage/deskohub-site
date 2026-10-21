import { join } from "node:path";
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
 * Bundles the booking view into one self-contained HTML document: its
 * script, styles, and copy inlined, with React's production build. Hosts
 * render it in a sandbox that loads nothing from other origins.
 */
export const buildBookingWidget = async () => {
  const build = await Bun.build({
    entrypoints: [join(widgetDirectory, "index.html")],
    compile: true,
    target: "browser",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [tailwindStylesheet],
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
