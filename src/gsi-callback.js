// Global Google Sign In callback defined early so GSI script can invoke it.
// It queues credentials until <salish-sea> is upgraded and ready.
(function(){
  const GLOBAL = window;
  GLOBAL.__pendingGSIResponses = GLOBAL.__pendingGSIResponses || [];
  GLOBAL.handleSignInWithGoogle = (response) => {
    try {
      const el = document.querySelector('salish-sea');
      if (el && typeof el.receiveIdToken === 'function') {
        el.receiveIdToken(response.credential);
      } else {
        GLOBAL.__pendingGSIResponses.push(response.credential);
      }
    } catch (e) {
      GLOBAL.__pendingGSIResponses.push(response.credential);
      throw e;
    }
  };
})();
