import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard, FolderOpen, MessageSquare, Bell, ShieldCheck, ListChecks, UserCog,
} from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { hapticTap } from "@/lib/native";

type Item = { to: string; label: string; icon: typeof LayoutDashboard; badge?: number };

/**
 * Barre de navigation inférieure (mobile / application native).
 * Cachée à partir de `lg` : le desktop garde la sidebar existante.
 */
export function MobileBottomNav({ countFor }: { countFor: (to: string) => number }) {
  const { isStaff, isExternal } = useRole();

  const items: Item[] = isExternal && !isStaff
    ? [
        { to: "/audits", label: "Dossiers", icon: ShieldCheck },
        { to: "/notifications", label: "Alertes", icon: Bell },
        { to: "/mes-donnees", label: "Profil", icon: UserCog },
      ]
    : isStaff
      ? [
          { to: "/admin", label: "Agence", icon: LayoutDashboard },
          { to: "/admin/dossiers", label: "Dossiers", icon: FolderOpen },
          { to: "/admin/taches-agence", label: "Tâches", icon: ListChecks },
          { to: "/admin/messages", label: "Messages", icon: MessageSquare },
          { to: "/mes-donnees", label: "Profil", icon: UserCog },
        ]
      : [
          { to: "/dashboard", label: "Accueil", icon: LayoutDashboard },
          { to: "/dossiers", label: "Dossiers", icon: FolderOpen },
          { to: "/messages", label: "Messages", icon: MessageSquare },
          { to: "/mes-donnees", label: "Profil", icon: UserCog },
        ];

  return (
    <nav
      className="mobile-bottom-nav lg:hidden fixed bottom-0 inset-x-0 z-50 w-full border-t border-border bg-background shadow-[0_-2px_10px_rgba(0,0,0,0.08)] pb-safe px-safe"
      aria-label="Navigation principale"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
        {items.map((n) => {
          const c = countFor(n.to);
          return (
            <li key={n.to} className="min-w-0">
              <Link
                to={n.to}
                onClick={() => { void hapticTap(); }}
                className="relative flex min-h-16 w-full flex-col items-center justify-center gap-1 px-0.5 py-2 text-[10px] leading-tight text-muted-foreground"
                activeProps={{ className: "text-primary font-medium" }}
              >
                <n.icon className="h-[20px] w-[20px] shrink-0" />
                <span className="w-full truncate px-0.5 text-center">{n.label}</span>
                {c > 0 && (
                  <span className="absolute top-1.5 right-[18%] h-4 min-w-4 px-1 rounded-full bg-gold text-[9px] font-semibold text-primary flex items-center justify-center">
                    {c > 9 ? "9+" : c}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
