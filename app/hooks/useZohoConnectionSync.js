import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

// The Zoho OAuth popup (see auth.zoho.callback.jsx) ends up on our own
// origin once Zoho redirects back, and posts a message to `window.opener`
// when it's done. We listen for that here and revalidate this page's loader
// so connect/disconnect shows up immediately, without the user refreshing.
//
// BroadcastChannel doesn't work for this: Chrome partitions it (and other
// storage-backed messaging APIs) by top-level site, and the embedded app
// lives in an iframe under admin.shopify.com while the OAuth popup is its
// own top-level tab on our app's domain - different partitions, so a
// broadcast from the popup never reaches the iframe even though both are
// same-origin. `postMessage` via a direct window handle isn't
// partition-scoped, so it isn't affected. This is why the popup is opened
// WITHOUT `noopener` - `window.opener` has to survive for this to work.
export function useZohoConnectionSync() {
  const revalidator = useRevalidator();
  const revalidatorRef = useRef(revalidator);
  revalidatorRef.current = revalidator;

  useEffect(() => {
    function handleMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.source !== "zoho-oauth") return;

      revalidatorRef.current.revalidate();
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);
}
