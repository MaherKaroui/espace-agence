drop policy if exists "Rapports quotidiens lecture admin direction" on storage.objects;
create policy "Rapports quotidiens lecture admin direction"
on storage.objects for select to authenticated
using (
  bucket_id = 'rapports-quotidiens'
  and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'direction'))
);