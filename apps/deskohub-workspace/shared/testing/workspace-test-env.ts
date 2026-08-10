import "@/shared/testing/workspace-test-environment";

import { mock } from "bun:test";

mock.module("server-only", () => ({}));
