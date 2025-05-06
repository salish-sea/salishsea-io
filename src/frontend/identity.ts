import { createAuth0Client, User } from '@auth0/auth0-spa-js';
import { createContext } from '@lit/context';

export const userContext = createContext<User | undefined>(Symbol('user'));
export const tokenContext = createContext<string | undefined>(Symbol('token'));
export const doLogInContext = createContext<() => Promise<boolean>>(Symbol('do-log-in'));
export const doLogOutContext = createContext<() => Promise<void>>(Symbol('do-log-out'));

export const auth0 = await createAuth0Client({
  domain: 'rainhead.auth0.com',
  cacheLocation: 'localstorage',
  clientId: 'yDgvV1cn-Q5XDbFQx1piWNVboU-Iwi1d',
});

const query = window.location.search;
if (query.includes("code=") && query.includes("state=")) {
  window.addEventListener('load', async () => {
    const result = auth0.handleRedirectCallback();
    console.log(result);
  });
}
