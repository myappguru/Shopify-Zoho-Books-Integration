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

    const styleId = "zoho-settings-connection-ui-fixes";
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        /* The connection page does not use a bottom action bar. */
        .connection-page + .content-footer {
          display: none !important;
        }

        /* Fallback customer glyph for the current Polaris icon set. */
        .sync-icon.purple {
          position: relative;
          overflow: hidden;
        }
        .sync-icon.purple s-icon[type="customer"] {
          display: none;
        }
        .sync-icon.purple::before {
          content: "";
          position: absolute;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: currentColor;
          top: 6px;
          left: 50%;
          transform: translateX(-50%);
        }
        .sync-icon.purple::after {
          content: "";
          position: absolute;
          width: 14px;
          height: 8px;
          border-radius: 9px 9px 4px 4px;
          background: currentColor;
          left: 50%;
          bottom: 5px;
          transform: translateX(-50%);
        }
      `;
      document.head.appendChild(style);
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);
}
