import { createClient } from '@supabase/supabase-js';
import { type Database } from '../../database.types.ts';
import type { MergeDeep } from 'type-fest';
import type { Occurrence } from '../occurrence.ts';

type TravelDirection = Database['public']['Enums']['travel_direction'];
type PatchedDatabase = MergeDeep<Database, {
  public: {
    Functions: {
      occurrences_on_date: {
        Return: Occurrence[];
      };
      upsert_sighting: {
        Args: {
          count: number | null;
          direction: TravelDirection | null;
          observer_location: [number, number] | null;
          subject_location: [number, number];
          url: string | null;
        }
      }
    }
  }
}>;

const publishableKey = import.meta.env.VITE_SUPABASE_KEY;
if (!publishableKey)
  throw new Error("Please set VITE_SUPABASE_KEY");

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
if (!supabaseUrl)
  throw new Error("Please set VITE_SUPABSAE_URL");

export const supabase = createClient<PatchedDatabase, 'public'>(
  supabaseUrl,
  publishableKey,
  // {
  //   accessToken: async () => {
  //     console.debug("Requesting access token for supabase.");
  //     const auth0 = await auth0promise;
  //     const claims = await auth0.getIdTokenClaims();
  //     if (!claims)
  //       return null;
  //     return claims.__raw;
  //   },
  // }
);
