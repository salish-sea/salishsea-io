import { createClient } from '@supabase/supabase-js'
import { type Database } from './database.types.ts';

const projectUrl = process.env.VITE_SUPABASE_URL;
if (!projectUrl)
  throw new Error("Please set VITE_SUPABASE_URL");

const secret = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_KEY;
if (!secret)
  throw new Error("Please set SUPABASE_KEY or VITE_SUPABASE_KEY");

export const supabase = createClient<Database, 'public'>(projectUrl, secret);

export type TravelDirection = Database['public']['Enums']['travel_direction'];
