import type { OnlyOptionalsRequired } from "@/types/only-optionals-required";
import { defaults } from "./defaults";

export const apiBodyDefault =
  <T extends object>(defaultValues: OnlyOptionalsRequired<T>) =>
  (body: T) =>
    defaults<typeof defaultValues, T>(defaultValues, body);
