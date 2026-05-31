import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input:
    "./openapi/dotypos-api.yaml",
  output: {
    path: "./src/generated",
    postProcess: ["biome:lint", "biome:format"],
  },
  plugins: [
    {
      name: "zod",
      definitions: true,
      requests: false,
      responses: true,
      metadata: true,
    },
    {
      name: "@hey-api/sdk",
      validator: true,
    },
  ],
});
