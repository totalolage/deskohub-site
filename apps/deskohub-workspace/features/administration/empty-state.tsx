export function EmptyState({ message }: { readonly message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-navy-blue/15 bg-white px-5 py-12 text-center text-sm text-navy-blue/65">
      {message}
    </div>
  );
}
