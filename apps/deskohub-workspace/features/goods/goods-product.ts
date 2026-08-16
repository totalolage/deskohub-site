import {
  DotyposCategoryIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { Schema } from "effect";

export const workspaceGoodsProductIdentitySchema = Schema.Struct({
  kind: Schema.Literal("goods"),
  categoryId: DotyposCategoryIdSchema,
  productId: DotyposProductIdSchema,
}).annotate({
  identifier: "WorkspaceGoodsProductIdentity",
  description:
    "Exact Workspace goods identity backed by a Dotypos product and category.",
});

export type WorkspaceGoodsProductIdentity =
  typeof workspaceGoodsProductIdentitySchema.Type;

const workspaceAllGoodsProductTargetSchema = Schema.Struct({
  kind: workspaceGoodsProductIdentitySchema.fields.kind,
  categoryId: Schema.optionalKey(Schema.Never),
  productId: Schema.optionalKey(Schema.Never),
});

const workspaceGoodsCategoryTargetSchema = Schema.Struct({
  kind: workspaceGoodsProductIdentitySchema.fields.kind,
  categoryId: workspaceGoodsProductIdentitySchema.fields.categoryId,
  productId: Schema.optionalKey(Schema.Never),
});

const workspaceGoodsProductTargetSchema = Schema.Struct({
  kind: workspaceGoodsProductIdentitySchema.fields.kind,
  categoryId: Schema.optionalKey(Schema.Never),
  productId: workspaceGoodsProductIdentitySchema.fields.productId,
});

export const workspaceGoodsTargetSchema = Schema.Union([
  workspaceAllGoodsProductTargetSchema,
  workspaceGoodsCategoryTargetSchema,
  workspaceGoodsProductTargetSchema,
]).annotate({
  identifier: "WorkspaceGoodsTarget",
  description:
    "All goods, one Dotypos category, or one Dotypos product eligible for a Workspace discount.",
});

export type WorkspaceGoodsTarget = typeof workspaceGoodsTargetSchema.Type;

export const workspaceGoodsProductKeySchema = Schema.TemplateLiteral([
  workspaceGoodsProductIdentitySchema.fields.kind,
  ":",
  workspaceGoodsProductIdentitySchema.fields.categoryId,
  ":",
  workspaceGoodsProductIdentitySchema.fields.productId,
]);

export type WorkspaceGoodsProductKey =
  typeof workspaceGoodsProductKeySchema.Type;

export const getWorkspaceGoodsProductKey = (
  product: WorkspaceGoodsProductIdentity
): WorkspaceGoodsProductKey =>
  `${product.kind}:${product.categoryId}:${product.productId}`;

export const getCanonicalWorkspaceGoodsProductIdentity = (
  product: WorkspaceGoodsProductIdentity
): WorkspaceGoodsProductIdentity => ({
  kind: product.kind,
  categoryId: product.categoryId,
  productId: product.productId,
});

export const getWorkspaceGoodsProductTarget = (
  product: WorkspaceGoodsProductIdentity
): WorkspaceGoodsTarget => ({
  kind: product.kind,
  productId: product.productId,
});

export const workspaceGoodsTargetMatches = (
  target: WorkspaceGoodsTarget,
  product: WorkspaceGoodsProductIdentity
): boolean => {
  if ("categoryId" in target) {
    return target.categoryId === product.categoryId;
  }
  if ("productId" in target) {
    return target.productId === product.productId;
  }
  return true;
};
