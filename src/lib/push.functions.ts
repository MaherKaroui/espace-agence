import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SubSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  user_agent: z.string().optional().nullable(),
});

const StatusSchema = z.object({
  endpoint: z.string().url().optional().nullable(),
});

export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  return { key: process.env.VAPID_PUBLIC_KEY ?? "" };
});

export const getPushSubscriptionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StatusSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { count, error: countError } = await supabase
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (countError) throw new Error(countError.message);

    let currentDeviceSaved = false;
    if (data.endpoint) {
      const { data: existing, error: existingError } = await supabase
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", userId)
        .eq("endpoint", data.endpoint)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      currentDeviceSaved = !!existing;
    }

    return { total: count ?? 0, currentDeviceSaved };
  });

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SubSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("save_push_subscription", {
      _endpoint: data.endpoint,
      _p256dh: data.p256dh,
      _auth: data.auth,
      _user_agent: data.user_agent ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ endpoint: z.string().url() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", data.endpoint)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
