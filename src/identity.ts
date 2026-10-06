import { createContext } from '@lit/context';
import type { Contributor, PatchedDatabase } from './types.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Who is signed in: all the app reads of a user is its id. Supabase's user has one, and
 * so does the write API's (decision 065).
 */
export type User = {id: string};
export const userContext = createContext<User | undefined>(Symbol('user'));

export const contributorContext = createContext<Contributor | undefined>(Symbol('contributor'));

export async function getContributor(user_id: string, supabase: SupabaseClient<PatchedDatabase>): Promise<Contributor> {
  const {data} = await supabase
    .from('user_contributor')
    .select('contributors(*)')
    .eq('user_uuid', user_id)
    .single()
    .throwOnError();
  return data.contributors;
}
