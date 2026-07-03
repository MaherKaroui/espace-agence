import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalFooter } from "@/components/legal-footer";

export const Route = createFileRoute("/politique-confidentialite")({
  head: () => ({
    meta: [
      { title: "Politique de confidentialité — Espace Client" },
      { name: "description", content: "Politique de confidentialité et traitement des données personnelles — FD CERTIF EXPERT." },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: Privacy,
});

function Privacy() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="border-b bg-card">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link to="/" className="font-display text-lg">Espace Agence</Link>
          <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">Se connecter</Link>
        </div>
      </div>
      <main className="flex-1 mx-auto max-w-4xl px-4 sm:px-6 py-10 prose prose-sm sm:prose-base max-w-none">
        <h1 className="font-display text-3xl mb-2">Politique de confidentialité</h1>
        <p className="text-sm text-muted-foreground">Version 1.0 — dernière mise à jour : 3 juillet 2026</p>

        <h2 className="font-display text-xl mt-8">1. Responsable du traitement</h2>
        <p>
          <strong>FD CERTIF EXPERT</strong>, 15 rue Auguste Gervais, 92130 Issy-les-Moulineaux.<br />
          Contact : <a href="mailto:admin@izi-business.com">admin@izi-business.com</a>.
        </p>

        <h2 className="font-display text-xl mt-8">2. Données collectées</h2>
        <ul>
          <li><strong>Compte client</strong> : nom, prénom, e-mail, téléphone, société, mot de passe (chiffré).</li>
          <li><strong>Fichiers déposés dans les dossiers</strong> : pièces d'identité, Kbis, justificatifs administratifs et financiers, documents de certification (Qualiopi, BPF, NDA, CFA, VAE).</li>
          <li><strong>Contenu des messages</strong> échangés avec l'agence.</li>
          <li><strong>Données techniques</strong> : adresse IP, journaux de connexion et d'activité, navigateur / appareil.</li>
        </ul>

        <h2 className="font-display text-xl mt-8">3. Finalités</h2>
        <ul>
          <li>Gestion des dossiers confiés à l'agence.</li>
          <li>Communication entre le client et l'agence.</li>
          <li>Sécurité et traçabilité de la plateforme.</li>
          <li>Respect des obligations légales liées aux démarches (Qualiopi, BPF, NDA, CFA, VAE…).</li>
        </ul>

        <h2 className="font-display text-xl mt-8">4. Bases légales</h2>
        <ul>
          <li>Exécution du contrat de prestation.</li>
          <li>Obligation légale (dossiers réglementaires).</li>
          <li>Intérêt légitime (sécurité de la plateforme).</li>
        </ul>

        <h2 className="font-display text-xl mt-8">5. Durées de conservation</h2>
        <ul>
          <li>Compte client : durée de la relation + 3 ans.</li>
          <li>Dossiers et fichiers : durée de la mission + durée légale de conservation applicable selon le type de document.</li>
          <li>Messages : durée de la relation + 1 an.</li>
          <li>Journaux techniques : 12 mois, puis purge automatique.</li>
        </ul>

        <h2 className="font-display text-xl mt-8">6. Destinataires</h2>
        <p>
          Le personnel habilité de FD CERTIF EXPERT uniquement. Sous-traitants techniques : <strong>Supabase</strong> (hébergement des données)
          et <strong>Lovable</strong> (hébergement applicatif). Aucun autre partage, sauf obligation légale ou transmission aux administrations
          concernées (DREETS, certificateur…) avec l'accord préalable du client.
        </p>

        <h2 className="font-display text-xl mt-8">7. Transferts hors UE</h2>
        <p>Aucun transfert de données hors Union européenne sans garanties appropriées. Aucune revente de données.</p>

        <h2 className="font-display text-xl mt-8">8. Vos droits</h2>
        <p>
          Vous disposez d'un droit d'accès, de rectification, d'effacement, de portabilité, de limitation et d'opposition. Vous pouvez les
          exercer via l'espace <Link to="/mes-donnees" className="text-primary underline">Mes données</Link> une fois connecté, ou en écrivant à
          <a href="mailto:admin@izi-business.com"> admin@izi-business.com</a>. Vous pouvez également introduire une réclamation auprès de la
          <a href="https://www.cnil.fr" target="_blank" rel="noreferrer"> CNIL</a>.
        </p>

        <h2 className="font-display text-xl mt-8">9. Sécurité</h2>
        <p>
          Les fichiers sont stockés dans des espaces privés et chiffrés. L'accès est restreint par des règles d'autorisation strictes : chaque
          client n'accède qu'à ses propres dossiers ; le personnel de l'agence dispose d'accès nominatifs et journalisés.
        </p>
      </main>
      <LegalFooter />
    </div>
  );
}
