/**
 * oauthFragmentGuard.js — remove OAuth credentials from the visible URL before
 * diagnostics and the rest of the application can observe them.
 *
 * This file must remain a synchronous, first-party script near the top of the
 * document. authService consumes the captured fragment once during boot.
 */
window.BARK = window.BARK || {};

(function guardOAuthFragment() {
    let capturedFragment = '';

    try {
        const rawFragment = window.location.hash ? window.location.hash.slice(1) : '';
        const params = new URLSearchParams(rawFragment);
        const isOAuthReturn = params.has('id_token') ||
            params.has('access_token') ||
            (params.has('error') && params.has('state'));

        if (isOAuthReturn) {
            capturedFragment = rawFragment;
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    } catch (_error) {
        // authService still has its direct-fragment fallback if early scrubbing
        // is unavailable in an unusual browser environment.
    }

    window.BARK.consumeOAuthRedirectFragment = function consumeOAuthRedirectFragment() {
        const value = capturedFragment;
        capturedFragment = '';
        return value;
    };
})();
