import { createAuth0Client, User } from '@auth0/auth0-spa-js';
import { createContext } from '@lit/context';

export const userContext = createContext<User | undefined>(Symbol('user'));
export const tokenContext = createContext<string | undefined>(Symbol('token'));
export const doLogInContext = createContext<() => Promise<boolean>>(Symbol('do-log-in'));
export const doLogOutContext = createContext<() => Promise<void>>(Symbol('do-log-out'));

export const auth0promise = createAuth0Client({
  domain: import.meta.env.VITE_AUTH0_DOMAIN,
  cacheLocation: 'localstorage',
  clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
});

const query = window.location.search;
if (query.includes("code=") && query.includes("state=")) {
  window.addEventListener('load', () => auth0promise.then(auth0 => auth0.handleRedirectCallback()));
}
