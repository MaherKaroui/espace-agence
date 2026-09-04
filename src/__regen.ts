import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { regenerateDigestPdf } from "@/lib/daily-activity-report.server";
const d = process.argv[2];
console.log(await regenerateDigestPdf(supabaseAdmin, d));
