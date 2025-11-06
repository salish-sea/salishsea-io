// Global Google Sign In callback defined early so GSI script can invoke it.

// It queues credentials until <salish-sea> is upgraded and ready.
(function(){
  const GLOBAL = window;
  GLOBAL.handleSignInWithGoogle = async (response: {credential: string}) => {
    GLOBAL.__pendingGSIResponses = GLOBAL.__pendingGSIResponses || [];
    const el = document.querySelector('salish-sea');
    if (el && el.isConnected) {
      try {
        return await el.receiveIdToken(response.credential);
      } catch (e) {
        GLOBAL.__pendingGSIResponses.push(response.credential);
        throw e;
      }
    } else {
      GLOBAL.__pendingGSIResponses.push(response.credential);
    }
  };
})();

declare global {
  interface Window {
    handleSignInWithGoogle: (response: {credential: string}) => void;
    __pendingGSIResponses?: string[];
  }
}
