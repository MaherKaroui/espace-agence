DROP INDEX IF EXISTS public.rendez_vous_slot_unique;
CREATE UNIQUE INDEX rendez_vous_slot_unique ON public.rendez_vous USING btree (starts_at) WHERE (status NOT IN ('annule','refuse'));