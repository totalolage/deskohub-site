import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./dotypos-api.yaml",
  output: {
    path: "../generated",
    format: "prettier",
    lint: "biome",
  },
});
