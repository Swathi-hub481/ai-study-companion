import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthTabs } from "@/components/auth/auth-tabs";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <AuthTabs active="login" />

      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome Back</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Sign in to continue your learning journey
        </p>
      </header>

      <AuthForm
        mode="login"
        footer={
          <p className="text-center text-[13px] text-[var(--color-ink-muted)]">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="font-medium text-[var(--color-brand-600)] underline-offset-4 hover:underline"
            >
              Sign up
            </Link>
          </p>
        }
      />
    </div>
  );
}
