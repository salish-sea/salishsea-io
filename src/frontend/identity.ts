import { createContext } from '@lit/context';
import type { User } from '@supabase/auth-js';

export type {User} from '@supabase/auth-js';
export const userContext = createContext<User | undefined>(Symbol('user'));
