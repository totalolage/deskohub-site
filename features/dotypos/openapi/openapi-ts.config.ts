import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./dotypos-api.yaml",
  output: {
    path: "../generated",
    postProcess: ["biome:lint", "biome:format"],
  },
  plugins: [
    // Generate Zod schemas for API validation
    {
      name: "zod",
      // Generate component schemas (needed for responses)
      definitions: true,
      // Don't generate request validators
      requests: false,
      // Generate response validators
      responses: true,
      // Include metadata for better documentation and validation
      metadata: true,
    },
    // Add validator support to SDK methods
    {
      name: "@hey-api/sdk",
      validator: true,
    },
  ],
});
