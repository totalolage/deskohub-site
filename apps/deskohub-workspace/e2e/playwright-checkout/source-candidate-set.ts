import { createHash } from "node:crypto";

export const hashWorkspaceE2ECandidateIds = (candidateIds: Iterable<string>) =>
  createHash("sha256")
    .update(JSON.stringify([...new Set(candidateIds)].toSorted()), "utf8")
    .digest("hex");
