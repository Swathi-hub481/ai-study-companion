import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { getCurrentUser, type SafeUser } from "@/lib/auth/session";

/**
 * Page-level session guard.
 *
 * Next.js renders a layout and its page concurrently, so a layout's redirect does
 * not mean the page can assume a session. Every page that loads user data resolves
 * the user itself. Redirecting (rather than throwing 401) is what a browser needs.
 */
export async function requireUserPage(): Promise<SafeUser> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

/**
 * Guard for the admin area.
 *
 * Redirects rather than throwing: a page render must produce something a browser can
 * follow. API routes still answer 403 through `requireAdmin`, which is the boundary that
 * actually protects the data — this only keeps non-admins out of a UI they cannot use.
 */
export async function requireAdminPage(): Promise<SafeUser> {
  const user = await requireUserPage();

  if (user.role !== Role.ADMIN) {
    redirect("/home");
  }

  return user;
}
