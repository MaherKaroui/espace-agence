
ALTER TABLE public.internal_conversations
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_only_posting boolean NOT NULL DEFAULT false;
