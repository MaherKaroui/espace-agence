import { describe, it, expect } from "vitest";
import {
  computeAvancement,
  etapesTerminees,
  etapesLabel,
  etapesLabelFromPercent,
} from "./dossier-progress";

describe("dossier-progress", () => {
  it("renvoie 0 sans étape", () => {
    expect(computeAvancement([], null)).toBe(0);
  });
  it("ignore les étapes annulées", () => {
    expect(computeAvancement([{ statut: "termine" }, { statut: "annule" }])).toBe(33);
  });
  it("plafonne à 3 étapes", () => {
    const t = Array.from({ length: 4 }, () => ({ statut: "termine" }));
    expect(etapesTerminees(t)).toBe(3);
    expect(computeAvancement(t)).toBe(100);
  });
  it("dossier validé ou terminé = 100", () => {
    expect(computeAvancement([], "valide")).toBe(100);
    expect(computeAvancement([], "termine")).toBe(100);
  });
  it("libellé des étapes", () => {
    expect(etapesLabel([{ statut: "termine" }])).toBe("Étapes du dossier (1/3)");
  });
  it("libellé depuis null", () => {
    expect(etapesLabelFromPercent(null)).toBe("Étapes du dossier (0/3)");
  });
  it("libellé depuis un pourcentage", () => {
    expect(etapesLabelFromPercent(null)).toBe("Étapes du dossier (0/3)");
    expect(etapesLabelFromPercent(150)).toBe("Étapes du dossier (3/3)");
  });
});
