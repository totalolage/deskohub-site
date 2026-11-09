// Preloaded into every Bun process of a coverage run through BUN_OPTIONS, so
// it registers before any test preload imports source files.
import { startCoverageCollection } from "./coverage-collection";

startCoverageCollection(process.env);
