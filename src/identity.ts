import { createContext } from '@lit/context';
import type { Contributor } from './types.ts';

/**
 * Who is signed in, as the write API names them (decision 065): all the app reads of a
 * user is its id.
 */
export type User = {id: string};
export const userContext = createContext<User | undefined>(Symbol('user'));

export const contributorContext = createContext<Contributor | undefined>(Symbol('contributor'));
