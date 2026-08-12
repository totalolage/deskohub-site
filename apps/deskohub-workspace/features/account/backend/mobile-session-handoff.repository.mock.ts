import { Layer } from "effect";
import { MobileSessionHandoffRepository } from "./mobile-session-handoff.repository";

export const MobileSessionHandoffRepositoryMock = Layer.mock(
  MobileSessionHandoffRepository
);
