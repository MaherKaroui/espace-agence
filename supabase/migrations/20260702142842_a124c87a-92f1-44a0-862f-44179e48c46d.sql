
-- Allow admins to delete profiles rows (auth user deletion handled server-side).
CREATE POLICY profiles_delete_admin ON public.profiles
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));
