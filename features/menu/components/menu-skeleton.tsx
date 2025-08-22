export function MenuSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Category skeleton */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="mb-12">
          <div className="h-8 bg-gray-800 rounded w-48 mx-auto mb-6" />
          <div className="grid gap-4 md:gap-6">
            {/* Item skeletons */}
            {[1, 2, 3, 4].map((j) => (
              <div
                key={j}
                className="flex justify-between items-start bg-black/40 backdrop-blur-sm rounded-lg p-4 border border-gray-800"
              >
                <div className="flex-1">
                  <div className="h-6 bg-gray-800 rounded w-3/4 mb-2" />
                  <div className="h-4 bg-gray-800 rounded w-1/2" />
                </div>
                <div className="h-8 bg-gray-800 rounded w-20 ml-4" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
