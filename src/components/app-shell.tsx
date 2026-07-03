import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, FolderOpen, MessageSquare, Bell, Users, Users2, LogOut, Menu, X, ShieldCheck, TrendingUp, Settings, CalendarDays, UserCog,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { roleLabelFr } from "@/lib/role-labels";
import { useRole } from "@/hooks/use-role";
import { useProfile } from "@/hooks/use-profile";
import { NotificationsBell } from "@/components/notifications-bell";
import { NotificationsRealtime } from "@/components/notifications-realtime";
import { SessionTracker } from "@/components/session-tracker";
import { AdminFlaggedAlert } from "@/components/admin-flagged-alert";
import { ConsentBanner } from "@/components/consent-banner";
import { LegalFooter } from "@/components/legal-footer";
import { cn } from "@/lib/utils";

import { useQueryClient } from "@tanstack/react-query";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isStaff, isDirectionOrAdmin, isAdmin, isDirection, isManager, isConsultant } = useRole();
  const roleLabel = isAdmin
    ? roleLabelFr("admin")
    : isDirection
      ? roleLabelFr("direction")
      : isManager
        ? roleLabelFr("manager")
        : isConsultant
          ? roleLabelFr("consultant")
          : roleLabelFr("client");
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const qc = useQueryClient();

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const nav = [
    { to: "/dashboard", label: "Accueil", icon: LayoutDashboard },
    { to: "/dossiers", label: "Mes dossiers", icon: FolderOpen },
    { to: "/rendez-vous", label: "Prendre rendez-vous", icon: CalendarDays },
    { to: "/messages", label: "Messages", icon: MessageSquare },
    { to: "/messages/groupes", label: "Groupes", icon: Users2 },
    { to: "/notifications", label: "Notifications", icon: Bell },
    { to: "/mes-donnees", label: "Mes données", icon: UserCog },
    { to: "/preferences", label: "Préférences", icon: Settings },
  ];


  // Staff (Manager/Consultant/Direction/Admin) — RLS filtre par pôle
  const staffNav = [
    { to: "/admin", label: "Vue agence", icon: LayoutDashboard },
    { to: "/admin/dossiers", label: "Dossiers de mes pôles", icon: FolderOpen },
    { to: "/admin/messages", label: "Messagerie agence", icon: MessageSquare },
    { to: "/admin/rendez-vous", label: "Rendez-vous", icon: CalendarDays },
  ];
  // Réservé Direction / Admin
  const directionNav = [
    { to: "/admin/direction", label: "Pilotage Direction", icon: TrendingUp },
    { to: "/admin/clients", label: "Clients", icon: Users },
    { to: "/admin/poles", label: "Pôles & équipes", icon: Users2 },
    { to: "/admin/sessions", label: "Temps de connexion", icon: TrendingUp },
    { to: "/admin/audit", label: "Journal d'audit", icon: ShieldCheck },
    { to: "/admin/security", label: "Sécurité", icon: ShieldCheck },
    { to: "/admin/rgpd", label: "RGPD", icon: UserCog },
  ];

  const signOut = async () => {
    // Ferme toutes les sessions ouvertes de l'utilisateur avant de perdre le token
    if (user) {
      const now = new Date().toISOString();
      await supabase
        .from("user_sessions")
        .update({ ended_at: now, last_seen_at: now })
        .eq("user_id", user.id)
        .is("ended_at", null);
    }
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const NavList = () => (
    <>
      <div className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/50">Espace client</div>
      {nav.map((n) => (
        <Link
          key={n.to} to={n.to}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground font-medium" }}
        >
          <n.icon className="h-4 w-4" /> {n.label}
        </Link>
      ))}
      {isStaff && (
        <>
          <div className="mt-6 px-3 py-2 text-xs font-medium uppercase tracking-wider text-gold">Agence</div>
          {staffNav.map((n) => (
            <Link
              key={n.to} to={n.to}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground font-medium" }}
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </Link>
          ))}
        </>
      )}
      {isDirectionOrAdmin && (
        <>
          <div className="mt-6 px-3 py-2 text-xs font-medium uppercase tracking-wider text-gold">Direction</div>
          {directionNav.map((n) => (
            <Link
              key={n.to} to={n.to}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground font-medium" }}
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </Link>
          ))}
        </>
      )}
    </>
  );

  const displayName = profile?.prenom || profile?.nom
    ? `${profile?.prenom ?? ""} ${profile?.nom ?? ""}`.trim()
    : user?.email ?? "";

  return (
    <div className="min-h-screen bg-background">
      <NotificationsRealtime />
      <SessionTracker />
      <AdminFlaggedAlert />
      <ConsentBanner />


      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="p-6 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-gold flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <span className="font-display text-lg">Espace Agence</span>
        </div>
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto"><NavList /></nav>
        <div className="p-3 border-t border-sidebar-border">
          <div className="px-3 py-2">
            <div className="text-sm font-medium truncate">{displayName}</div>
            <div className="text-xs text-sidebar-foreground/50 truncate">{roleLabel}</div>
          </div>
          <button onClick={signOut} className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent">
            <LogOut className="h-4 w-4" /> Déconnexion
          </button>
        </div>
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-sidebar text-sidebar-foreground p-3 flex flex-col">
            <button aria-label="Fermer le menu" className="self-end p-2" onClick={() => setMobileOpen(false)}><X className="h-5 w-5" /></button>
            <nav className="flex-1 space-y-1 overflow-y-auto"><NavList /></nav>
            <button onClick={signOut} className="mt-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent">
              <LogOut className="h-4 w-4" /> Déconnexion
            </button>
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/95 backdrop-blur px-4 sm:px-6 h-16">
          <button aria-label="Ouvrir le menu" className="lg:hidden p-2" onClick={() => setMobileOpen(true)}><Menu className="h-5 w-5" /></button>
          <div className="lg:hidden font-display">Espace Agence</div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2">
            <NotificationsBell />
          </div>
        </header>
        <main className={cn("p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto")}>{children}</main>
      </div>
    </div>
  );
}
