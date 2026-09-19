import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { StatePanel } from "@/components/ui/state-panel";

/**
 * 404 for the whole site.
 *
 * The app deliberately answers "not found" for resources that exist but belong to someone
 * else, so this page is reached in two different situations. It says so, rather than
 * implying the learner mistyped a URL — and it does not disclose which of the two it was,
 * because doing so would confirm that an id exists.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-16">
      <StatePanel
        tone="brand"
        icon={Compass}
        eyebrow="Not found"
        title="We could not find that page"
        body="It may have been deleted, or it may belong to another account. Links you followed from your own dashboard should always work — if one did not, that is a bug worth reporting."
      >
        <Link href="/home" className={buttonVariants()}>
          Go to Home
        </Link>
        <Link href="/spaces" className={buttonVariants({ variant: "outline" })}>
          Browse Spaces
        </Link>
      </StatePanel>
    </main>
  );
}
