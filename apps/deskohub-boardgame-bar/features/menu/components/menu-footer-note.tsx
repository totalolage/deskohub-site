import { PriceInfo } from "@/shared/components";

export function MenuFooterNote() {
  return (
    <div className="text-center mt-16 p-6 bg-black/40 backdrop-blur-sm rounded-lg border border-green-400/20">
      <p className="text-gray-300">
        <PriceInfo />
      </p>
    </div>
  );
}
