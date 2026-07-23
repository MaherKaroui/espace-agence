import { useEffect } from "react";

/**
 * Fait défiler vers l'élément correspondant à `location.hash` une fois qu'il
 * apparaît dans le DOM (utile quand la page charge ses données de façon async).
 */
export function useScrollToHash(deps: unknown[] = []) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash?.slice(1);
    if (!hash) return;
    let tries = 0;
    const tick = () => {
      const el = document.getElementById(hash);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("ring-2", "ring-primary/50", "rounded-lg");
        setTimeout(() => el.classList.remove("ring-2", "ring-primary/50", "rounded-lg"), 1600);
        return;
      }
      if (tries++ < 20) setTimeout(tick, 150);
    };
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
