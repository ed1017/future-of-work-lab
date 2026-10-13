import Link from "next/link";
import { SignInForm } from "@/components/governance/sign-in-form";
import { SiteHeader } from "@/components/site-header";
import { Card, CardHeading } from "@/components/card";
import { getAdmin, missingAdminConfig } from "@/lib/admin/auth";

export const metadata = { title: "Admin sign-in | Future of Work Lab" };

export default async function SignInPage() {
  const admin = await getAdmin();
  const missing = missingAdminConfig();
  return (
    <div className="min-h-screen">
      <SiteHeader active="/governance" />
      <main className="mx-auto max-w-md px-4 py-12">
        <Card>
          <CardHeading title="Admin sign-in" subtitle="Only the admin can add or edit governance register entries. Everyone else can view." />
          {admin ? (
            <p className="text-sm">
              You&apos;re signed in. <Link className="text-primary underline underline-offset-4" href="/governance">Back to the register</Link>
            </p>
          ) : missing.length ? (
            <p className="text-sm text-muted-foreground">
              Sign-in isn&apos;t configured on this deployment. Missing: {missing.join(", ")}.
            </p>
          ) : (
            <SignInForm />
          )}
        </Card>
        <p className="mt-4 text-sm">
          <Link className="text-primary underline underline-offset-4" href="/governance">
            Back to the register
          </Link>
        </p>
      </main>
    </div>
  );
}
