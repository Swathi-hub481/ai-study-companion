import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Authenticated shell.
 *
 * The session check happens here, in a server component, before any child renders.
 * Unauthenticated requests are redirected rather than rendering a partial page, so
 * no project-scoped data can be fetched on behalf of an anonymous visitor. The shell
 * itself is a client component only because navigation has state (the mobile drawer);
 * the page content stays server-rendered and is passed through as children.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <AppShell
      user={{ name: user.name, email: user.email, isAdmin: user.role === Role.ADMIN }}
    >
      {children}
    </AppShell>
  );
}
