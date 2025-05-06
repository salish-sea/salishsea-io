import { createAuth0Client } from '@auth0/auth0-spa-js';

export const auth0 = await createAuth0Client({
  domain: 'rainhead.auth0.com',
  cacheLocation: 'localstorage',
  clientId: 'yDgvV1cn-Q5XDbFQx1piWNVboU-Iwi1d',
});

export const logIn = async () => {
  await auth0.loginWithPopup({
    authorizationParams: {
      redirect_uri: 'http://localhost:3131/auth_redirect.html',
    }
  });
};

export const logOut = async () => {
  await auth0.logout({openUrl: false});
}

const query = window.location.search;
if (query.includes("code=") && query.includes("state=")) {
  window.addEventListener('load', async () => {
    const result = auth0.handleRedirectCallback();
    console.log(result);
  });
}
