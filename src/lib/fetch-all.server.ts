/**
 * Lit toutes les lignes d'une requête par pages de 1 000 (plafond PostgREST), jusqu'à `cap` lignes (20 000 par défaut).
 * `build()` doit renvoyer un NOUVEAU builder à chaque appel, déjà trié sur une colonne stable.
 */
export async function fetchAllRows<T>(build: () => any, cap = 20000): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out.length > cap ? out.slice(0, cap) : out;
}
