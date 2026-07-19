/**
 * firstOpenDisclaimer.js - First-open "call ahead" disclaimer + Terms agreement.
 *
 * Shows a one-time blocking modal on first open. The user must (a) read the
 * "program info is fluid, call ahead" notice and (b) check a box agreeing to the
 * Terms of Use and Privacy Policy before continuing. Agreement is persisted
 * per-version in localStorage so returning users aren't asked again. Bump
 * AGREEMENT_VERSION whenever the Terms/Privacy or disclaimer copy changes
 * materially, to re-prompt everyone for fresh consent.
 */
window.BARK = window.BARK || {};

(function () {
    const AGREEMENT_VERSION = 1;
    const STORAGE_KEY = 'barkTermsAgreement';

    function hasAgreed() {
        try {
            return localStorage.getItem(STORAGE_KEY) === String(AGREEMENT_VERSION);
        } catch (err) {
            // Private mode / storage blocked — fail open by showing the notice.
            return false;
        }
    }

    function rememberAgreement() {
        try {
            localStorage.setItem(STORAGE_KEY, String(AGREEMENT_VERSION));
        } catch (err) {
            // Non-fatal: user just sees the notice again next session.
        }
    }

    function initFirstOpenDisclaimer() {
        const overlay = document.getElementById('disclaimer-modal');
        const acceptButton = document.getElementById('disclaimer-accept-btn');
        const agreeCheckbox = document.getElementById('disclaimer-agree-checkbox');
        if (!overlay || !acceptButton || !agreeCheckbox) return;

        if (hasAgreed()) return;

        const syncButtonState = () => {
            const ready = agreeCheckbox.checked;
            acceptButton.disabled = !ready;
            acceptButton.style.opacity = ready ? '1' : '0.5';
            acceptButton.style.cursor = ready ? 'pointer' : 'not-allowed';
        };

        const accept = () => {
            if (!agreeCheckbox.checked) return;
            overlay.style.display = 'none';
            overlay.setAttribute('aria-hidden', 'true');
            rememberAgreement();
        };

        // Start unchecked/disabled every open so consent is a deliberate action.
        agreeCheckbox.checked = false;
        syncButtonState();

        overlay.style.display = 'flex';
        overlay.setAttribute('aria-hidden', 'false');
        agreeCheckbox.focus({ preventScroll: true });

        agreeCheckbox.addEventListener('change', syncButtonState);
        acceptButton.addEventListener('click', accept);
    }

    window.BARK.initFirstOpenDisclaimer = initFirstOpenDisclaimer;
})();
