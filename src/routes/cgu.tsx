import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalFooter } from "@/components/legal-footer";

export const Route = createFileRoute("/cgu")({
  head: () => ({
    meta: [
      { title: "CGU — IZISuivis" },
      { name: "description", content: "Conditions Générales d'Utilisation de la plateforme FD CERTIF EXPERT." },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: CGU,
});

function CGU() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="border-b bg-card">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link to="/" className="font-display text-lg">IZISuivis</Link>
          <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">Se connecter</Link>
        </div>
      </div>
      <main className="flex-1 mx-auto max-w-4xl px-4 sm:px-6 py-10 prose prose-sm sm:prose-base max-w-none">
        <h1 className="font-display text-3xl mb-2">Conditions Générales d'Utilisation</h1>
        <p className="text-sm text-muted-foreground">Version 1.0 — dernière mise à jour : 3 juillet 2026</p>

        <h2 className="font-display text-xl mt-8">1. Éditeur du service</h2>
        <p>
          <strong>FD CERTIF EXPERT</strong>, SASU au capital de 100 €, SIREN 988 018 479 — SIRET 988 018 479 00010,
          RCS Nanterre, TVA FR65988018479, 15 rue Auguste Gervais, 92130 Issy-les-Moulineaux.<br />
          Contact : <a href="mailto:admin@izi-business.com">admin@izi-business.com</a>.
        </p>

        <h2 className="font-display text-xl mt-8">2. Objet</h2>
        <p>
          La plateforme met à disposition des clients de FD CERTIF EXPERT un espace sécurisé pour transmettre les documents nécessaires à leurs
          démarches (Qualiopi, BPF, NDA, CFA, VAE), suivre l'avancement de leurs dossiers et échanger avec l'agence.
        </p>

        <h2 className="font-display text-xl mt-8">3. Création du compte</h2>
        <p>
          Le compte est créé par le client ou par l'agence à sa demande. Le client s'engage à fournir des informations exactes et à conserver
          la confidentialité de ses identifiants. Toute action réalisée depuis son compte est réputée effectuée par lui.
        </p>

        <h2 className="font-display text-xl mt-8">4. Documents déposés</h2>
        <p>
          Le client garantit disposer des droits nécessaires pour déposer les documents transmis, y compris ceux comportant des données de
          tiers (salariés, formateurs, stagiaires). Le client reste propriétaire de l'ensemble de ses fichiers. L'agence ne les utilise que
          pour l'exécution de la mission confiée.
        </p>

        <h2 className="font-display text-xl mt-8">5. Confidentialité et sécurité</h2>
        <p>
          Les fichiers sont stockés dans des espaces privés et chiffrés. L'accès est journalisé. Le client s'engage à ne pas tenter de
          contourner les mesures de sécurité mises en place.
        </p>

        <h2 className="font-display text-xl mt-8">6. Disponibilité</h2>
        <p>
          L'agence met en œuvre les moyens raisonnables pour assurer la disponibilité du service. Elle peut néanmoins procéder à des
          interruptions pour maintenance sans préavis lorsqu'elles s'avèrent nécessaires.
        </p>

        <h2 className="font-display text-xl mt-8">7. Résiliation</h2>
        <p>
          Le client peut à tout moment demander la clôture de son compte depuis l'espace <Link to="/mes-donnees" className="text-primary underline">Mes données</Link>. L'agence
          se réserve le droit de suspendre un compte en cas de manquement grave aux présentes conditions.
        </p>

        <h2 className="font-display text-xl mt-8">8. Données personnelles</h2>
        <p>Le traitement des données personnelles est décrit dans la <Link to="/politique-confidentialite" className="text-primary underline">Politique de confidentialité</Link>.</p>

        <h2 className="font-display text-xl mt-8">9. Droit applicable</h2>
        <p>
          Les présentes CGU sont soumises au droit français. En cas de litige, les tribunaux du ressort de Nanterre seront compétents, sous
          réserve des règles impératives applicables aux consommateurs.
        </p>
      </main>
      <LegalFooter />
    </div>
  );
}
