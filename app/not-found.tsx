import Link from "next/link";
import { m } from "@/i18n";
import RootLayout from "./rootLayout";

export default function NotFound() {
  return (
    <RootLayout>
      <div className="flex items-center justify-center bg-white">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-gray-900 mb-4">404</h1>
          <h2 className="text-2xl font-semibold text-gray-700 mb-4">
            {m["errors.pageNotFound"]()}
          </h2>
          <p className="text-gray-600 mb-8">
            {m["errors.pageNotFoundDescription"]()}
          </p>
          <Link
            href="/"
            className="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg transition-colors"
          >
            {m["errors.goHome"]()}
          </Link>
        </div>
      </div>
    </RootLayout>
  );
}
