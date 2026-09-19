import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthTabs } from "@/components/auth/auth-tabs";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <div className="flex flex-col gap-6">
      <AuthTabs active="register" />

      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Start a space, add a project, and build from there
        </p>
      </header>

      <AuthForm
        mode="register"
        footer={
          <p className="text-center text-[13px] text-[var(--color-ink-muted)]">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-[var(--color-brand-600)] underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        }
      />
    </div>
  );
}
