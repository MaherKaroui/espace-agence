
CREATE OR REPLACE FUNCTION public.shares_conversation(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_members m1
    JOIN public.conversation_members m2 ON m1.conversation_id = m2.conversation_id
    WHERE m1.user_id = _a AND m2.user_id = _b
  );
$$;

DROP POLICY IF EXISTS profiles_select_self_or_admin ON public.profiles;
CREATE POLICY profiles_select_self_admin_or_shared_group ON public.profiles
FOR SELECT USING (
  auth.uid() = id
  OR has_role(auth.uid(), 'admin'::app_role)
  OR public.shares_conversation(auth.uid(), id)
);
