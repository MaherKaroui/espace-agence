-- Plan 011 : liste des discussions de la messagerie admin sans parcourir tous les messages.
-- APPLIQUÉE en production le 17/11/2026 (fonction + droits seulement, aucune donnée modifiée). Testée : 18 ms.

create or replace function public.admin_message_threads()
returns table (
  client_id uuid,
  last_id uuid,
  last_created_at timestamptz,
  last_from_agence boolean,
  last_sender_id uuid,
  unread_count bigint,
  total_count bigint,
  seen_read_at timestamptz,
  seen_read_by uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'Accès refusé';
  end if;

  return query
  with m as (
    select id, messages.client_id as cid, created_at, coalesce(from_agence, false) as from_agence, sender_id, read_at, read_by
    from public.messages
    where deleted_at is null
  ),
  agg as (
    select cid,
           count(*) as total_count,
           count(*) filter (where not from_agence and read_at is null) as unread_count
    from m
    group by cid
  ),
  last_msg as (
    select distinct on (cid) cid, id, created_at, from_agence, sender_id
    from m
    order by cid, created_at desc, id desc
  ),
  seen as (
    select distinct on (cid) cid, read_at, read_by
    from m
    where not from_agence and read_at is not null
    order by cid, created_at desc, id desc
  )
  select l.cid, l.id, l.created_at, l.from_agence, l.sender_id,
         a.unread_count, a.total_count, s.read_at, s.read_by
  from last_msg l
  join agg a on a.cid = l.cid
  left join seen s on s.cid = l.cid
  order by l.created_at desc;
end;
$$;

revoke execute on function public.admin_message_threads() from public, anon;
grant execute on function public.admin_message_threads() to authenticated;
