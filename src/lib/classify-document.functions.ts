import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const DOC_TYPES = [
  "kbis",
  "b3",
  "cni",
  "cv",
  "diplome",
  "bilan",
  "compte_resultat",
  "convention",
  "programme",
  "reglement",
  "attestation",
  "rib",
  "nda",
  "bpf",
  "qualiopi",
  "catalogue",
  "autre",
] as const;

const Input = z.object({ documentId: z.string().uuid() });

export const classifyDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => Input.parse(v))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("id, nom, storage_path, mime_type")
      .eq("id", data.documentId)
      .maybeSingle();
    if (docErr) throw new Error(docErr.message);
    if (!doc) throw new Error("Document introuvable");

    const mime = doc.mime_type ?? "";
    const isImage = mime.startsWith("image/");
    const isPdf = mime === "application/pdf";
    if (!isImage && !isPdf) {
      return { skipped: true, reason: "type non supporté" };
    }

    const { data: signed, error: sErr } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 300);
    if (sErr || !signed?.signedUrl) throw new Error(sErr?.message ?? "URL signée impossible");

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY manquant");

    const contentBlock = isImage
      ? { type: "image_url", image_url: { url: signed.signedUrl } }
      : {
          type: "file",
          file: { filename: doc.nom, file_data: signed.signedUrl },
        };

    const systemPrompt = `Tu es un classifieur de documents administratifs français.
Réponds STRICTEMENT en JSON: {"type": "<code>", "confidence": <0-1>, "reason": "<court>"}.
Codes autorisés: ${DOC_TYPES.join(", ")}.
Définitions:
- kbis: extrait Kbis (registre du commerce)
- b3: extrait de casier judiciaire bulletin n°3
- cni: carte nationale d'identité, passeport, titre de séjour
- cv: curriculum vitae
- diplome: diplôme, certificat de scolarité, attestation de réussite
- bilan / compte_resultat / convention / programme / reglement / attestation / rib / nda / bpf / qualiopi / catalogue: contenus correspondants
- autre: si aucun ne correspond`;

    const body = {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: `Fichier: ${doc.nom}. Identifie le type.` },
            contentBlock,
          ],
        },
      ],
      response_format: { type: "json_object" },
    };

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`AI Gateway ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const json: any = await resp.json();
    const raw = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { type?: string; confidence?: number } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    const type = DOC_TYPES.includes(parsed.type as any) ? (parsed.type as string) : "autre";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : null;

    const { error: uErr } = await supabase
      .from("documents")
      .update({
        detected_type: type,
        detected_at: new Date().toISOString(),
        detection_confidence: confidence,
      })
      .eq("id", doc.id);
    if (uErr) throw new Error(uErr.message);

    return { type, confidence };
  });
