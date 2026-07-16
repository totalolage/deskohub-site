import { Layer } from "effect";
import { DiscountDefinitionRepository } from "./discount-definition.repository";

export const DiscountDefinitionRepositoryMock = Layer.mock(
  DiscountDefinitionRepository
);
