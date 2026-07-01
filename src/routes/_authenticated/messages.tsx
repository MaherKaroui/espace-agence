import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Paperclip, Send, Search } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ChatWindow } from "@/components/chat-window";

export const Route = createFileRoute("/_authenticated/messages")({
  head: () => ({ meta: [{ title: "Messagerie" }] }),
  component: MessagesPage,
});

function MessagesPage() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  if (!user) return null;
  if (isAdmin) return <div className="p-8">Utilisez la messagerie agence dans la barre latérale.</div>;
  return <ChatWindow clientId={user.id} />;
}
