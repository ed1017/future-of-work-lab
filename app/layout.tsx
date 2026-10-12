import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const productTitle = "Future of Work Lab | HR AI Exposure, Adoption & Governance";

const productDescription =
  "Future of Work Lab is a public portfolio demo showing where AI changes work first, whether people use AI safely, and what to do about it. All employee data is synthetic.";

export const metadata: Metadata = {
  title: productTitle,
  description: productDescription,
  openGraph: {
    title: productTitle,
    description: productDescription,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: productTitle,
    description: productDescription,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
