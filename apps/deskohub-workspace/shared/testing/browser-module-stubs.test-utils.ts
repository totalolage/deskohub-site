/**
 * A browser harness build plugin that replaces each named module with the
 * given source, for modules such as `next/navigation` that only work inside
 * their framework.
 */
export const browserModuleStubPlugin = (
  stubs: Readonly<Record<string, string>>
): Bun.BunPlugin => {
  const namespace = "browser-module-stub";
  const stubbedModules = Object.keys(stubs).map((specifier) =>
    specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
  );
  return {
    name: namespace,
    setup(build) {
      build.onResolve(
        { filter: new RegExp(`^(?:${stubbedModules.join("|")})$`) },
        (args) => ({ namespace, path: args.path })
      );
      build.onLoad({ filter: /.*/, namespace }, (args) => ({
        contents: stubs[args.path] ?? "",
        loader: "js",
      }));
    },
  };
};
