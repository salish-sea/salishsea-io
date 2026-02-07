import { createContext } from '@lit/context';
import type { User } from '@supabase/auth-js';
import type { Contributor, PatchedDatabase } from './types.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

export type {User} from '@supabase/auth-js';
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
