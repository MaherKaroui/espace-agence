import type { CapacitorConfig } from "@capacitor/cli";

/**
 * IZISuivis — configuration Capacitor (Android + iOS).
 *
 * L'application native charge directement le site publié (https://izisuivis.com).
 * Conséquence : une seule base de code, un seul backend, une seule authentification,
 * et chaque publication depuis Lovable est immédiatement visible sur mobile
 * sans avoir à recompiler ni republier les applications sur les stores.
 */
const config: CapacitorConfig = {
  appId: "com.izisuivis.app",
  appName: "IZISuivis",
  webDir: "dist",
  server: {
    // Live update : le natif sert le site publié.
    url: "https://izisuivis.com",
    cleartext: false,
    androidScheme: "https",
    // Domaines autorisés à s'ouvrir dans la WebView (auth, stockage, API).
    allowNavigation: [
      "izisuivis.com",
      "*.izisuivis.com",
      "*.lovable.app",
      "*.supabase.co",
      "accounts.google.com",
      "appleid.apple.com",
    ],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: "#0B1B33",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashImmersive: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0B1B33",
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
