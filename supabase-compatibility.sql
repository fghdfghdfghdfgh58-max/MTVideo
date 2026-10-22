-- Run this only if your Supabase reacts table still has the column named `value`.
-- Your MTVideo PostgreSQL server expects this column to be named `val`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reacts' AND column_name='value'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reacts' AND column_name='val'
  ) THEN
    ALTER TABLE public.reacts RENAME COLUMN value TO val;
  END IF;
END $$;
