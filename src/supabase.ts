import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { PatchedDatabase } from './types.ts';

let _supabase: SupabaseClient<PatchedDatabase> | undefined;

export const supabase = () => {
  if (_supabase)
    return _supabase;

  const publishableKey = import.meta.env.VITE_SUPABASE_KEY;
  if (!publishableKey)
    throw new Error("Please set VITE_SUPABASE_KEY");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl)
    throw new Error("Please set VITE_SUPABASE_URL");

  _supabase = createClient<PatchedDatabase, 'public'>(
    supabaseUrl,
    publishableKey,
  );
  return _supabase;
};
