import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  client: '@hey-api/client-fetch',
  input: './dotypos-api.yaml',
  output: {
    path: '../generated',
    format: 'prettier',
    lint: 'biome',
  },
  types: {
    enums: 'javascript',
  },
  services: {
    asClass: true,
  },
});