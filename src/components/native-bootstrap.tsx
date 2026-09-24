import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { initNativeShell, isNativeApp, nativePlatform, registerAndroidBackButton } from "@/lib/native";

/**
 * Monté une seule fois à la racine : initialise Capacitor (status bar, splash,
 * clavier), marque le document pour les styles natifs et gère le bouton Retour
 * Android. Sur le Web, il ne reste que la détection du clavier logiciel.
 */
export function NativeBootstrap() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;
    const root = document.documentElement;
    root.classList.add("capacitor-native", `platform-${nativePlatform()}`);
    void initNativeShell();

    let cleanup: (() => void) | undefined;
    registerAndroidBackButton(
      () => window.history.length > 1,
      () => router.history.back(),
    ).then((fn) => {
      cleanup = fn;
    });

    return () => cleanup?.();
  }, [router]);

  /**
   * Clavier logiciel sur le Web mobile.
   *
   * Dans l'application Capacitor, le plugin Keyboard pose déjà la classe
   * `keyboard-open`. Dans un navigateur mobile, personne ne la posait : la
   * barre de navigation `fixed bottom-0` était donc poussée vers le haut par
   * le clavier et venait recouvrir la zone de saisie.
   *
   * `visualViewport` est le seul moyen de repérer le clavier côté Web : il
   * rétrécit à son ouverture, alors que `innerHeight` et `100dvh` ne bougent
   * pas. On publie aussi sa hauteur dans `--vvh`, dont la fenêtre de
   * discussion se sert pour rester entièrement visible.
   */
  useEffect(() => {
    if (isNativeApp()) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const sync = () => {
      const open = window.innerHeight - vv.height > 150;
      root.classList.toggle("keyboard-open", open);
      if (open) root.style.setProperty("--vvh", `${vv.height}px`);
      else root.style.removeProperty("--vvh");
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      root.classList.remove("keyboard-open");
      root.style.removeProperty("--vvh");
    };
  }, []);

  return null;
}
