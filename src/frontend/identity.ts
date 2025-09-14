import { createAuth0Client, type User } from '@auth0/auth0-spa-js';
import { createContext } from '@lit/context';
export { type User } from '@auth0/auth0-spa-js';

const redirectUri = new URL('/auth_redirect.html', window.location.href).toString();
const scopes ='openid name email';

export const userContext = createContext<User | undefined>(Symbol('user'));
export const tokenContext = createContext<string | undefined>(Symbol('token'));
export const doLogInContext = createContext<() => Promise<boolean>>(Symbol('do-log-in'));
export const doLogOutContext = createContext<() => Promise<void>>(Symbol('do-log-out'));

const authorizationParams = {
  audience: import.meta.env.VITE_AUTH0_AUDIENCE,
  redirect_uri: redirectUri,
  scope: scopes,
};

export const auth0promise = createAuth0Client({
  domain: import.meta.env.VITE_AUTH0_DOMAIN,
  cacheLocation: 'localstorage',
  clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
});

export const doLogIn = async () => {
  const auth0 = await auth0promise;
  await auth0.loginWithPopup({authorizationParams});
}

export const doLogOut = async () => {
  const auth0 = await auth0promise;
  return await auth0.logout({openUrl: false});
}

export const getTokenSilently = async () => {
  const auth0 = await auth0promise;
  return await auth0.getTokenSilently({authorizationParams});
};

export const getUser = async () => {
  const auth0 = await auth0promise;
  return await auth0.getUser();
}

const query = window.location.search;
if (query.includes("code=") && query.includes("state=")) {
  window.addEventListener('load', () => auth0promise.then(auth0 => auth0.handleRedirectCallback()));
}
