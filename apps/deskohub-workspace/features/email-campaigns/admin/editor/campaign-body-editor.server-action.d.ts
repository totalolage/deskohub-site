declare module "next/dist/compiled/react-server-dom-turbopack/client.browser" {
  export interface TemporaryReferenceSet {
    readonly __brand: "TemporaryReferenceSet";
  }

  export function createTemporaryReferenceSet(): TemporaryReferenceSet;

  export function encodeReply<Value>(
    value: Value,
    options?: { readonly temporaryReferences?: TemporaryReferenceSet }
  ): Promise<string | FormData>;
}
