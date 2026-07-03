import { Link } from "@tanstack/react-router";

/** Pied de page public avec liens légaux — utilisé sur toutes les pages. */
export function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`border-t bg-background/60 py-4 px-4 sm:px-6 ${className}`}>
      <div className="mx-auto flex max-w-7xl flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
        <div>© {new Date().getFullYear()} FD CERTIF EXPERT — Tous droits réservés.</div>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link to="/mentions-legales" className="hover:text-foreground">Mentions légales</Link>
          <Link to="/politique-confidentialite" className="hover:text-foreground">Politique de confidentialité</Link>
          <Link to="/cgu" className="hover:text-foreground">CGU</Link>
        </nav>
      </div>
    </footer>
  );
}
