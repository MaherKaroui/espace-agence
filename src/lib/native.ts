/**
 * Couche d'abstraction Capacitor.
 * Tout est optionnel : sur le Web rien ne s'exécute, l'application reste identique.
 */

let cachedNative: boolean | null = null;

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  if (cachedNative !== null) return cachedNative;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  cachedNative = Boolean(cap?.isNativePlatform?.());
  return cachedNative;
}

export function nativePlatform(): "ios" | "android" | "web" {
  if (typeof window === "undefined") return "web";
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const p = cap?.getPlatform?.() ?? "web";
  return p === "ios" || p === "android" ? p : "web";
}

/** Initialise status bar, splash screen et clavier sur mobile natif. */
export async function initNativeShell(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const [{ StatusBar, Style }, { SplashScreen }] = await Promise.all([
      import("@capacitor/status-bar"),
      import("@capacitor/splash-screen"),
    ]);
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    if (nativePlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: "#0B1B33" }).catch(() => {});
    }
    await SplashScreen.hide().catch(() => {});
  } catch {
    /* plugin absent : on ignore */
  }
  try {
    const { Keyboard } = await import("@capacitor/keyboard");
    Keyboard.addListener("keyboardWillShow", () => {
      document.documentElement.classList.add("keyboard-open");
    });
    Keyboard.addListener("keyboardWillHide", () => {
      document.documentElement.classList.remove("keyboard-open");
    });
  } catch {
    /* ignore */
  }
}

/** Bouton Retour Android : navigue en arrière, quitte l'app à la racine. */
export async function registerAndroidBackButton(canGoBack: () => boolean, goBack: () => void) {
  if (!isNativeApp() || nativePlatform() !== "android") return () => {};
  try {
    const { App } = await import("@capacitor/app");
    const handle = await App.addListener("backButton", () => {
      if (canGoBack()) goBack();
      else App.exitApp();
    });
    return () => handle.remove();
  } catch {
    return () => {};
  }
}

/** Retour haptique léger (no-op sur Web). */
export async function hapticTap(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* ignore */
  }
}

/**
 * Prise de photo native si disponible, sinon `null`
 * (l'appelant retombe alors sur l'input file du Web).
 */
export async function takePhotoFile(): Promise<File | null> {
  if (!isNativeApp()) return null;
  try {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    const photo = await Camera.getPhoto({
      quality: 80,
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt,
freeform: false,
    } as never);
    if (!photo.webPath) return null;
    const blob = await fetch(photo.webPath).then((r) => r.blob());
    const ext = photo.format || "jpeg";
    return new File([blob], `photo-${Date.now()}.${ext}`, { type: blob.type || `image/${ext}` });
  } catch {
    return null;
  }
}
