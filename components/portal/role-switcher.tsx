import Link from "next/link";

import { destinationsFor, type PortalRoleFlags } from "@/lib/portal/destinations";
import { cn } from "@/lib/utils";

/**
 * Small switcher between portals for an account with more than one role
 * (for example owner and manager). Renders nothing for a single-role account.
 */
export function PortalRoleSwitcher({
  roles,
  current,
}: {
  roles: PortalRoleFlags | null | undefined;
  current: string;
}) {
  const options = destinationsFor(roles);
  if (options.length < 2) return null;
  return (
    <nav aria-label="Switch portal" className="mb-6 flex flex-wrap items-center gap-2">
      {options.map((option) => {
        const active = option.role === current;
        return (
          <Link
            key={option.role}
            href={option.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 font-heading text-xs tracking-[0.16em] uppercase ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
              active
                ? "bg-white/10 text-white ring-white/25"
                : "text-white/60 ring-white/10 hover:text-white hover:ring-white/25"
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
