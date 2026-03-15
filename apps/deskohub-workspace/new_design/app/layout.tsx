import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "deskohub cowork | Coworking & Meetup Space",
  description:
    "A modern coworking and meetup space for freelancers, remote workers, and startups. Work better together at deskohub.",
  keywords: [
    "coworking",
    "meetup",
    "workspace",
    "office space",
    "remote work",
    "freelancer",
    "startup",
  ],
};

export const viewport: Viewport = {
  themeColor: "#00024f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
