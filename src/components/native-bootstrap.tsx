import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { initNativeShell, isNativeApp, nativePlatform, registerAndroidBackButton } from "@/lib/native";

/**
 * Monté une seule fois à la racine : initialise Capacitor (status bar, splash,
 * clavier), marque le document pour les styles natifs et gère le bouton Retour Android.
 * Sur le Web, ce composant ne fait strictement rien.
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

  return null;
}
