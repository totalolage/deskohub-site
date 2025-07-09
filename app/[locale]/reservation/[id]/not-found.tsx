import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { m } from "@/i18n";

export default function BookingNotFound() {
  return (
    <div className="container max-w-3xl mx-auto py-12 px-4">
      <Card className="text-center">
        <CardHeader>
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              role="img"
              aria-label="Error cross"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <CardTitle className="text-2xl font-bold text-red-800">
            {m["errors.bookingNotFound"]()}
          </CardTitle>
          <CardDescription className="text-lg">
            {m["errors.bookingNotFoundDescription"]()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-gray-600">
              If you believe this is an error, please contact us with your
              booking details.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild>
                <Link href="/reservation">{m["thankYou.makeAnother"]()}</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/">{m["thankYou.backToHome"]()}</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
