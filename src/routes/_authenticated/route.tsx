import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    // 2FA TOTP obligatoire
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    // nextLevel = 'aal2' si un facteur existe, sinon 'aal1'.
    // On force le passage par /auth/mfa tant que la session n'est pas aal2.
    if (aal && aal.currentLevel !== "aal2") {
      throw redirect({ to: "/auth/mfa" });
    }
    return { user: data.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

