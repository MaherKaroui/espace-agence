import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalFooter } from "@/components/legal-footer";

export const Route = createFileRoute("/mentions-legales")({
  head: () => ({
    meta: [
      { title: "Mentions légales — Espace Client" },
      { name: "description", content: "Mentions légales de la plateforme FD CERTIF EXPERT." },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: MentionsLegales,
});

function MentionsLegales() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="border-b bg-card">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link to="/" className="font-display text-lg">IZISuivis</Link>
          <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">Se connecter</Link>
        </div>
      </div>
      <main className="flex-1 mx-auto max-w-4xl px-4 sm:px-6 py-10 prose prose-sm sm:prose-base max-w-none">
        <h1 className="font-display text-3xl mb-6">Mentions légales</h1>

        <h2 className="font-display text-xl mt-8">Éditeur du site</h2>
        <p>
          <strong>FD CERTIF EXPERT</strong>, SASU au capital de 100 €<br />
          SIREN : 988 018 479 — SIRET : 988 018 479 00010<br />
          RCS Nanterre n° 988 018 479<br />
          TVA intracommunautaire : FR65988018479<br />
          Siège social : 15 rue Auguste Gervais, 92130 Issy-les-Moulineaux, France<br />
          E-mail : <a href="mailto:admin@izi-business.com">admin@izi-business.com</a>
        </p>

        <h2 className="font-display text-xl mt-8">Directrice de la publication</h2>
        <p>Nadine Dendani, Présidente.</p>

        <h2 className="font-display text-xl mt-8">Hébergement</h2>
        <p>
          Application hébergée par <strong>Lovable</strong> (Lovable Labs).<br />
          Base de données et stockage des fichiers : <strong>Supabase</strong>, région <strong>UE — Francfort (eu-central-1)</strong>.
        </p>

        <h2 className="font-display text-xl mt-8">Propriété intellectuelle</h2>
        <p>
          L'ensemble des éléments composant la plateforme (textes, marques, logos, interfaces) est protégé par le droit de la propriété
          intellectuelle. Toute reproduction, représentation ou exploitation non autorisée est interdite. Les documents déposés par les
          clients restent la propriété exclusive de ces derniers.
        </p>

        <h2 className="font-display text-xl mt-8">Contact</h2>
        <p>Pour toute question relative au site : <a href="mailto:admin@izi-business.com">admin@izi-business.com</a>.</p>
      </main>
      <LegalFooter />
    </div>
  );
}
