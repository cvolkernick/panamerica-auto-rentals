import type { Metadata } from "next";

import { SignInPortal } from "./sign-in-portal";

export const metadata: Metadata = {
  title: "Sign in",
  robots: "noindex",
};

export const dynamic = "force-static";

export default function SignInPage() {
  return <SignInPortal />;
}
