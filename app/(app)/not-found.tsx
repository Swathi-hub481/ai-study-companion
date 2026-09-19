import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { StatePanel } from "@/components/ui/state-panel";

/**
 * 404 for the authenticated area.
 *
 * A Space, Project, Material or Quiz the caller cannot reach reaches this through
 * `notFound()`, and rendering it *inside* the shell keeps the navigation and the account
 * menu available — which is the whole point of a not-found page.
 *
 * The wording still covers both reasons (deleted, or someone else's) without saying which,
 * because the app deliberately makes those indistinguishable. HTTP behaviour is
 * unchanged: this is the same 404, presented better.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col justify-center py-12">
      <StatePanel
        tone="brand"
        icon={Compass}
        eyebrow="Not found"
        title="We could not find that resource"
        body="It may have been deleted, or it may belong to another account. Anything you reached from your own dashboard should always work — if it did not, that is a bug worth reporting."
      >
        <Link href="/home" className={buttonVariants()}>
          Go to Home
        </Link>
        <Link href="/spaces" className={buttonVariants({ variant: "outline" })}>
          Browse Spaces
        </Link>
      </StatePanel>
    </div>
  );
}
