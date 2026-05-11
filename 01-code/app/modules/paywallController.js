/**
 * paywallController.js - Internal test-mode paywall UI and checkout handoff.
 *
 * Premium unlock remains read-only from Firestore entitlement via premiumService.
 */
(function () {
    window.BARK = window.BARK || {};
    window.BARK.services = window.BARK.services || {};

    const PRICE_COPY = '$9.99/year';
    const PROVIDER = 'lemonsqueezy';
    const DEFAULT_VERIFYING_FALLBACK_MS = 15000;

    let initialized = false;
    let lastSource = 'manual';
    let returnState = null;
    let returnStateStartedAt = null;
    let returnStateUserUid = null;
    let checkoutInFlight = false;
    let restorePurchaseInFlight = false;
    let restoreStatusMessage = null;
    let unsubscribePremium = null;
    let verificationFallbackTimer = null;

    function getElement(id) {
        return document.getElementById(id);
    }

    function getPremiumService() {
        return window.BARK.services && window.BARK.services.premium;
    }

    function getCurrentUser() {
        try {
            return typeof firebase !== 'undefined' && firebase.auth
                ? firebase.auth().currentUser
                : null;
        } catch (error) {
            return null;
        }
    }

    function isPasswordAuthUser(user) {
        const providerIds = (user && Array.isArray(user.providerData) ? user.providerData : [])
            .map(provider => provider && provider.providerId)
            .filter(Boolean);
        return providerIds.includes('password');
    }

    function needsEmailVerification(user) {
        return Boolean(user && user.email && isPasswordAuthUser(user) && user.emailVerified !== true);
    }

    function getEmailVerificationMessage() {
        return 'Please verify your email before using Premium checkout, coupons, or premium routing.';
    }

    function isPremiumActive() {
        const premiumService = getPremiumService();
        return Boolean(
            premiumService &&
            typeof premiumService.isPremium === 'function' &&
            premiumService.isPremium()
        );
    }

    function isCheckoutEnabled() {
        return !window.BARK ||
            typeof window.BARK.isLaunchFlagEnabled !== 'function' ||
            window.BARK.isLaunchFlagEnabled('checkoutEnabled');
    }

    function getCheckoutDisabledMessage() {
        return window.BARK && typeof window.BARK.getLaunchFlagMessage === 'function'
            ? window.BARK.getLaunchFlagMessage('checkoutEnabled')
            : 'Premium checkout is paused for this beta. Please try again after the next release update.';
    }

    function getEntitlement() {
        const premiumService = getPremiumService();
        return premiumService && typeof premiumService.getEntitlement === 'function'
            ? premiumService.getEntitlement()
            : { premium: false, status: 'free', source: 'none' };
    }

    function isLemonSqueezyEntitlement(entitlement) {
        return Boolean(
            entitlement &&
            (
                entitlement.source === 'lemon_squeezy' ||
                entitlement.providerCustomerId ||
                entitlement.providerSubscriptionId ||
                entitlement.lemonSqueezySubscriptionId
            )
        );
    }

    function getReturnStateFromUrl() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('provider') !== PROVIDER) return null;
        const checkout = params.get('checkout');
        if (checkout === 'success' || checkout === 'canceled') return checkout;
        return null;
    }

    function clearCheckoutReturnState() {
        const url = new URL(window.location.href);
        url.searchParams.delete('checkout');
        url.searchParams.delete('provider');
        window.history.replaceState({}, document.title, url.toString());
        returnState = null;
        returnStateStartedAt = null;
        returnStateUserUid = null;
        restoreStatusMessage = null;
        clearVerificationFallbackTimer();
    }

    function clearCheckoutParams() {
        clearCheckoutReturnState();
        renderCurrentState();
    }

    function clearVerifiedCheckoutReturnState(state) {
        if (!state || state.mode !== 'premium' || returnState !== 'success') return;
        clearCheckoutReturnState();
    }

    function syncCheckoutReturnAccount(user) {
        if (returnState !== 'success') return false;

        const uid = user && user.uid ? user.uid : null;
        if (!uid) {
            if (!returnStateUserUid) return false;
            clearCheckoutReturnState();
            return true;
        }

        if (!returnStateUserUid) {
            returnStateUserUid = uid;
            return false;
        }

        if (returnStateUserUid !== uid) {
            clearCheckoutReturnState();
            return true;
        }

        return false;
    }

    function setText(id, text) {
        const node = getElement(id);
        if (node) node.textContent = text;
    }

    function setVisible(id, visible) {
        const node = getElement(id);
        if (!node) return;
        node.hidden = !visible;
    }

    function setButtonState(button, options) {
        if (!button) return;
        button.textContent = options.text;
        button.disabled = options.disabled === true;
        button.dataset.mode = options.mode || '';
    }

    function formatAccessDate(value) {
        if (!value) return 'Not set';
        let date = null;
        if (typeof value === 'number') date = new Date(value);
        else if (typeof value === 'string') date = new Date(value);
        else if (value instanceof Date) date = value;
        else if (typeof value.toMillis === 'function') date = new Date(value.toMillis());
        else if (Number.isFinite(Number(value.seconds))) {
            date = new Date((Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1000000));
        }
        if (!date || Number.isNaN(date.getTime())) return 'Not set';
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function getAccessCodeAudienceLabel(value) {
        switch (value) {
            case 'admin_mod': return 'Admin/mod complimentary access';
            case 'vip': return 'VIP access';
            case 'support': return 'Support access';
            case 'tester': return 'Tester access';
            default: return 'Complimentary access';
        }
    }

    function getInactiveCopy(status) {
        if (status === 'access_code_expired') {
            return 'Free Premium access ended. Subscribe through Lemon Squeezy to continue Premium.';
        }
        if (status === 'expired') {
            return 'Premium has expired on this account. You can upgrade again when ready.';
        }
        if (status === 'canceled') {
            return 'Premium is not active on this account. You can upgrade again when ready.';
        }
        if (status === 'refunded') {
            return 'Premium was removed after a refund. You can upgrade again when ready.';
        }
        return 'Premium is not active on this account.';
    }

    function normalizeSource(source) {
        const normalized = typeof source === 'string' ? source.trim() : '';
        if ([
            'global-town-search',
            'global-search',
            'global-towns',
            'federated-search'
        ].includes(normalized)) {
            return 'global-town-search';
        }

        if ([
            'virtual-trails',
            'premium-virtual-trail',
            'premium-trail-controls',
            'toggle-virtual-trail',
            'toggle-completed-trails'
        ].includes(normalized)) {
            return 'virtual-trails';
        }

        if ([
            'premium-map-filters',
            'premium-map-filter',
            'premium-visited-filter',
            'premium-map-style',
            'visited-filter',
            'map-style'
        ].includes(normalized)) {
            return 'premium-map-filters';
        }

        if ([
            'saved-route',
            'saved-routes',
            'load-route',
            'route-save',
            'route-load'
        ].includes(normalized)) {
            return 'saved-routes';
        }

        if ([
            'visited-place-limit',
            'free-visit-limit',
            'mark-visited-limit',
            'verified-checkin-limit'
        ].includes(normalized)) {
            return 'visited-place-limit';
        }

        return normalized || 'manual';
    }

    function getFeatureUpgradeCopy(source = lastSource) {
        const normalized = normalizeSource(source);

        if (normalized === 'global-town-search') {
            return {
                title: 'Global towns and cities are a Premium feature',
                eyebrow: 'Premium trip search',
                body: 'Upgrade to search beyond B.A.R.K. stops, add any city or town to your trip, and build routes around real-world stops.',
                primaryText: 'Upgrade Now'
            };
        }

        if (normalized === 'virtual-trails') {
            return {
                title: 'Virtual trail tracking is a Premium feature',
                eyebrow: 'Premium trail tracking',
                body: 'Upgrade to turn on active-trail progress and conquered-trail overlays on the map.',
                primaryText: 'Upgrade Now'
            };
        }

        if (normalized === 'premium-map-filters') {
            return {
                title: 'Premium map filters are a Premium feature',
                eyebrow: 'Premium map tools',
                body: 'Upgrade to use visited-aware filters, premium map styles, and route pin filtering while planning.',
                primaryText: 'Upgrade Now'
            };
        }

        if (normalized === 'saved-routes') {
            return {
                title: 'Saved routes are a Premium feature',
                eyebrow: 'Premium trip planning',
                body: 'Upgrade to save trip plans, reload routes later, and keep multi-day route notes with your account.',
                primaryText: 'Upgrade Now'
            };
        }

        if (normalized === 'visited-place-limit') {
            return {
                title: 'Adding more than 5 parks is a Premium feature',
                eyebrow: 'Premium park tracking',
                body: 'Free accounts can track up to 5 visited parks. Upgrade to keep adding visited parks, preserve your B.A.R.K. progress, and grow your passport without the free limit.',
                primaryText: 'Upgrade Now'
            };
        }

        if (normalized === 'premium-map-tools') {
            return {
                title: 'Premium map tools are a Premium feature',
                eyebrow: 'Premium map tools',
                body: 'Upgrade for visited-aware filters, premium map styles, virtual trail controls, and global town search.',
                primaryText: 'Upgrade Now'
            };
        }

        return null;
    }

    function getSignedOutUpgradeCopy() {
        const featureCopy = getFeatureUpgradeCopy();
        if (featureCopy) {
            return {
                title: featureCopy.title,
                eyebrow: featureCopy.eyebrow,
                body: `${featureCopy.body} Sign in first so premium can be attached to your BARK Ranger account.`,
                primaryText: 'Sign in to upgrade'
            };
        }

        return {
            title: 'Sign in to upgrade',
            eyebrow: 'Account required',
            body: 'Sign in first so premium can be attached to your BARK Ranger account. You can use Google or email/password.',
            primaryText: 'Sign in to upgrade'
        };
    }

    function getFreeUpgradeCopy() {
        const featureCopy = getFeatureUpgradeCopy();
        if (featureCopy) return featureCopy;

        if (lastSource === 'route-generation') {
            return {
                title: 'Route generation is a Premium feature',
                eyebrow: 'Premium routing',
                body: 'Upgrade to generate driving routes between trip stops. Free accounts can still plan stops without calling premium routing.',
                primaryText: 'Upgrade Now'
            };
        }

        if (lastSource === 'cloud-settings-sync') {
            return {
                title: 'Cloud settings sync is a Premium feature',
                eyebrow: 'Premium sync',
                body: 'Local settings save automatically on this device. Upgrade to sync your preferences across devices.',
                primaryText: 'Upgrade Now'
            };
        }

        return {
            title: 'Upgrade to BARK Ranger Premium',
            eyebrow: 'Annual plan',
            body: 'Unlock the premium map tools for one annual plan.',
            primaryText: 'Continue to secure checkout'
        };
    }

    function getVerifyingFallbackMs() {
        const configured = Number(window.BARK && window.BARK.PAYWALL_VERIFYING_FALLBACK_MS);
        return Number.isFinite(configured) && configured >= 0
            ? configured
            : DEFAULT_VERIFYING_FALLBACK_MS;
    }

    function getReturnStateElapsedMs() {
        return returnStateStartedAt ? Date.now() - returnStateStartedAt : 0;
    }

    function clearVerificationFallbackTimer() {
        if (!verificationFallbackTimer) return;
        clearTimeout(verificationFallbackTimer);
        verificationFallbackTimer = null;
    }

    function scheduleVerificationFallbackRender(state) {
        clearVerificationFallbackTimer();
        if (!state || state.mode !== 'verifying') return;

        const remainingMs = Math.max(0, getVerifyingFallbackMs() - getReturnStateElapsedMs());
        verificationFallbackTimer = setTimeout(() => {
            verificationFallbackTimer = null;
            renderCurrentState();
        }, remainingMs + 25);
    }

    function getState() {
        const user = getCurrentUser();
        syncCheckoutReturnAccount(user);
        const entitlement = getEntitlement();

        if (returnState === 'canceled') {
            return {
                mode: 'canceled',
                title: 'Checkout canceled',
                eyebrow: 'No charge',
                body: 'Checkout canceled. No charge was made, and your account is still on Free.',
                primaryText: user ? 'Continue to secure checkout' : 'Sign in to upgrade',
                secondaryVisible: true,
                clearVisible: true
            };
        }

        if (returnState === 'success' && !isPremiumActive() && !user) {
            return {
                mode: 'verify-signed-out',
                title: 'Sign in to verify premium',
                eyebrow: 'Account required',
                body: 'Checkout returned, but no signed-in account is available. Sign in with the same account used at checkout to verify premium.',
                primaryText: 'Sign in to verify premium',
                secondaryVisible: true,
                clearVisible: false
            };
        }

        if (returnState === 'success' && !isPremiumActive()) {
            if (getReturnStateElapsedMs() >= getVerifyingFallbackMs()) {
                return {
                    mode: 'verification-delayed',
                    title: 'Still verifying premium',
                    eyebrow: 'Payment pending',
                    body: restoreStatusMessage || 'Still verifying premium. Recheck the Lemon Squeezy subscription for this signed-in email before starting another checkout.',
                    primaryText: 'Restore / recheck purchase',
                    secondaryVisible: true,
                    clearVisible: false
                };
            }

            return {
                mode: 'verifying',
                title: 'Verifying payment...',
                eyebrow: 'Payment pending',
                body: 'Checkout finished. Premium unlocks only after the verified webhook updates this account.',
                primaryText: 'Checking account...',
                primaryDisabled: true,
                secondaryVisible: true,
                clearVisible: false
            };
        }

        if (!isCheckoutEnabled() && !isPremiumActive()) {
            return {
                mode: 'checkout-disabled',
                title: 'Premium checkout is paused',
                eyebrow: 'Beta safety',
                body: getCheckoutDisabledMessage(),
                primaryText: 'Checkout paused',
                primaryDisabled: true,
                secondaryVisible: true,
                clearVisible: returnState !== null
            };
        }

        if (!user) {
            const signedOutCopy = getSignedOutUpgradeCopy();
            return {
                mode: 'signed-out',
                title: signedOutCopy.title,
                eyebrow: signedOutCopy.eyebrow,
                body: signedOutCopy.body,
                primaryText: signedOutCopy.primaryText,
                secondaryVisible: true,
                clearVisible: returnState !== null
            };
        }

        if (isPremiumActive()) {
            let activeCopy = 'Premium is active on this account.';
            let eyebrow = 'Unlocked';
            let title = 'Premium active';
            let primaryText = 'Premium is active';

            if (entitlement.status === 'manual_active') {
                activeCopy = 'Premium is active through a manual account grant.';
            } else if (entitlement.status === 'access_code_active' && entitlement.source === 'access_code') {
                eyebrow = 'Free access';
                title = 'Free Premium Access';
                primaryText = 'Free access active';
                activeCopy = `${getAccessCodeAudienceLabel(entitlement.accessCodeAudience)}. Access ends: ${formatAccessDate(entitlement.expiresAt)}. Auto-renew: No. Payment method: None.`;
            } else if (entitlement.status === 'past_due') {
                eyebrow = 'Payment attention';
                activeCopy = 'Premium remains active while Lemon Squeezy retries your payment. Manage billing to keep access uninterrupted.';
            } else if (entitlement.status === 'cancelled_active') {
                eyebrow = 'Cancels later';
                activeCopy = `Access ends: ${formatAccessDate(entitlement.currentPeriodEnd || entitlement.endsAt)}. Auto-renew: No.`;
            }

            return {
                mode: 'premium',
                title,
                eyebrow,
                body: activeCopy,
                primaryText,
                primaryDisabled: true,
                secondaryVisible: false,
                clearVisible: false
            };
        }

        if (['expired', 'canceled', 'refunded', 'access_code_expired'].includes(entitlement.status)) {
            return {
                mode: 'inactive',
                title: 'Premium inactive',
                eyebrow: entitlement.status.replace(/_/g, ' '),
                body: restoreStatusMessage || getInactiveCopy(entitlement.status),
                primaryText: 'Continue to secure checkout',
                secondaryVisible: true,
                clearVisible: returnState === 'canceled',
                restoreVisible: isLemonSqueezyEntitlement(entitlement)
            };
        }

        const freeCopy = getFreeUpgradeCopy();
        return {
            mode: 'free',
            title: freeCopy.title,
            eyebrow: freeCopy.eyebrow,
            body: freeCopy.body,
            primaryText: freeCopy.primaryText,
            secondaryVisible: true,
            clearVisible: returnState !== null
        };
    }

    function renderProfileCard(state) {
        const card = getElement('profile-premium-card');
        if (!card) return;

        const mode = state.mode;
        const entitlement = getEntitlement();
        const isAccessCodePremium = mode === 'premium' &&
            entitlement.source === 'access_code' &&
            entitlement.status === 'access_code_active';
        card.dataset.paywallState = mode;
        setText('profile-premium-eyebrow', mode === 'premium' ? (isAccessCodePremium ? 'Free access' : 'Premium') : 'Premium map tools');
        setText('profile-premium-price', mode === 'premium' ? (isAccessCodePremium ? 'No renewal' : 'Active') : PRICE_COPY);

        if (mode === 'premium') {
            setText('profile-premium-status', isAccessCodePremium ? 'Free Premium Access' : 'Premium active');
            setText('profile-premium-copy', state.body);
            setButtonState(getElement('profile-premium-action'), {
                text: isAccessCodePremium ? 'Free access active' : 'Premium is active',
                disabled: true,
                mode
            });
            return;
        }

        if (mode === 'signed-out' || mode === 'verify-signed-out') {
            setText('profile-premium-status', 'Sign in first');
            setText('profile-premium-copy', mode === 'verify-signed-out'
                ? 'Sign in with the same account used at checkout to verify premium.'
                : 'Create or open your account before starting checkout.');
            setButtonState(getElement('profile-premium-action'), {
                text: mode === 'verify-signed-out' ? 'Sign in to verify premium' : 'Sign in to upgrade',
                mode
            });
            return;
        }

        if (mode === 'verifying' || mode === 'verification-delayed') {
            setText('profile-premium-status', mode === 'verification-delayed' ? 'Still verifying premium' : 'Verifying payment...');
            setText('profile-premium-copy', mode === 'verification-delayed'
                ? 'Recheck the Lemon Squeezy subscription for this signed-in email before starting another checkout.'
                : 'Premium unlocks when the verified webhook updates Firestore entitlement.');
            setButtonState(getElement('profile-premium-action'), {
                text: mode === 'verification-delayed' ? 'Restore / recheck purchase' : 'Checking account...',
                disabled: mode !== 'verification-delayed',
                mode
            });
            return;
        }

        if (mode === 'checkout-disabled') {
            setText('profile-premium-status', 'Checkout paused');
            setText('profile-premium-copy', state.body);
            setButtonState(getElement('profile-premium-action'), {
                text: 'Checkout paused',
                disabled: true,
                mode
            });
            return;
        }

        if (mode === 'canceled') {
            setText('profile-premium-status', 'Checkout canceled');
            setText('profile-premium-copy', 'No charge was made. Your account is still on Free.');
            setButtonState(getElement('profile-premium-action'), {
                text: 'Continue to secure checkout',
                mode
            });
            return;
        }

        setText('profile-premium-status', mode === 'inactive' ? 'Premium inactive' : 'Free plan');
        setText('profile-premium-copy', mode === 'inactive' ? state.body : 'Upgrade for visited-aware filters, map styles, trail controls, and global towns.');
        setButtonState(getElement('profile-premium-action'), {
            text: 'Upgrade',
            mode
        });
    }

    function renderCurrentState() {
        const state = getState();
        clearVerifiedCheckoutReturnState(state);
        const overlay = getElement('paywall-overlay');
        if (overlay) overlay.dataset.paywallState = state.mode;

        setText('paywall-eyebrow', state.eyebrow);
        setText('paywall-title', state.title);
        setText('paywall-price', PRICE_COPY);
        setText('paywall-body', state.body);
        setText('paywall-source', `Opened from ${lastSource.replace(/-/g, ' ')}`);
        setVisible('paywall-clear-url-btn', state.clearVisible === true);
        setVisible('paywall-restore-btn', state.restoreVisible === true);
        setVisible('paywall-secondary-btn', state.secondaryVisible !== false);

        setButtonState(getElement('paywall-primary-btn'), {
            text: checkoutInFlight
                ? 'Opening checkout...'
                : restorePurchaseInFlight && state.mode === 'verification-delayed'
                    ? 'Rechecking purchase...'
                    : state.primaryText,
            disabled: state.primaryDisabled === true || checkoutInFlight || (restorePurchaseInFlight && state.mode === 'verification-delayed'),
            mode: state.mode
        });
        setButtonState(getElement('paywall-restore-btn'), {
            text: restorePurchaseInFlight ? 'Rechecking purchase...' : 'Restore purchase',
            disabled: restorePurchaseInFlight,
            mode: state.mode
        });

        renderProfileCard(state);
        scheduleVerificationFallbackRender(state);
        return state;
    }

    function openPaywall(options = {}) {
        lastSource = typeof options.source === 'string' && options.source.trim()
            ? options.source.trim()
            : 'manual';
        const overlay = getElement('paywall-overlay');
        if (!overlay) return;
        renderCurrentState();
        overlay.classList.add('active');
        overlay.setAttribute('aria-hidden', 'false');
        const primary = getElement('paywall-primary-btn');
        if (primary) primary.focus({ preventScroll: true });
    }

    function closePaywall() {
        const overlay = getElement('paywall-overlay');
        if (!overlay) return;
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
    }

    function focusSignIn() {
        closePaywall();
        const profileTab = document.querySelector('.nav-item[data-target="profile-view"]');
        if (profileTab) profileTab.click();

        setTimeout(() => {
            const loginContainer = getElement('login-container');
            const emailInput = getElement('account-signin-email');
            const googleBtn = getElement('google-login-btn');
            if (loginContainer) loginContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (emailInput) emailInput.focus({ preventScroll: true });
            else if (googleBtn) googleBtn.focus({ preventScroll: true });
        }, 120);
    }

    function getCheckoutCallable() {
        if (typeof firebase === 'undefined' || typeof firebase.functions !== 'function') {
            throw new Error('Firebase Functions SDK is not available.');
        }
        return firebase.functions().httpsCallable('createCheckoutSession');
    }

    function getRestorePurchaseCallable() {
        if (typeof firebase === 'undefined' || typeof firebase.functions !== 'function') {
            throw new Error('Firebase Functions SDK is not available.');
        }
        return firebase.functions().httpsCallable('restorePremiumPurchase');
    }

    function applyRestoredEntitlement(entitlement, user) {
        if (!entitlement || typeof entitlement !== 'object') return false;
        const premiumService = getPremiumService();
        if (!premiumService || typeof premiumService.setEntitlement !== 'function') return false;
        premiumService.setEntitlement(entitlement, {
            uid: user && user.uid ? user.uid : null,
            reason: 'checkout-restore'
        });
        return Boolean(premiumService.isPremium && premiumService.isPremium());
    }

    function validateCheckoutUrl(value) {
        if (typeof value !== 'string' || !value.trim()) return null;
        try {
            const url = new URL(value);
            return url.protocol === 'https:' ? url.toString() : null;
        } catch (error) {
            return null;
        }
    }

    async function startCheckout() {
        if (!isCheckoutEnabled()) {
            renderCurrentState();
            return;
        }

        const state = getState();

        if (state.mode === 'signed-out' || state.mode === 'verify-signed-out') {
            focusSignIn();
            return;
        }

        if (state.mode === 'verification-delayed') {
            await restorePurchase();
            return;
        }

        if (state.mode === 'premium' || state.mode === 'verifying') {
            return;
        }

        const user = getCurrentUser();
        if (needsEmailVerification(user)) {
            setText('paywall-body', getEmailVerificationMessage());
            return;
        }

        checkoutInFlight = true;
        restoreStatusMessage = null;
        renderCurrentState();

        try {
            const createCheckoutSession = getCheckoutCallable();
            if (typeof window.BARK.incrementRequestCount === 'function') {
                window.BARK.incrementRequestCount();
            }
            const result = await createCheckoutSession({});
            const checkoutUrl = validateCheckoutUrl(result && result.data && result.data.checkoutUrl);
            if (!checkoutUrl) throw new Error('Checkout URL was missing from the backend response.');
            window.location.assign(checkoutUrl);
        } catch (error) {
            console.error('[paywallController] createCheckoutSession failed:', error);
            const message = error && error.message && /paused|disabled|unavailable/i.test(error.message)
                ? error.message
                : 'Checkout could not start. Please try again in a moment or contact support.';
            setText('paywall-body', message);
            setButtonState(getElement('paywall-primary-btn'), {
                text: 'Try again',
                disabled: false,
                mode: 'error'
            });
        } finally {
            checkoutInFlight = false;
            renderProfileCard(getState());
        }
    }

    async function restorePurchase() {
        const user = getCurrentUser();
        if (!user) {
            focusSignIn();
            return;
        }

        if (needsEmailVerification(user)) {
            setText('paywall-body', getEmailVerificationMessage());
            return;
        }

        restorePurchaseInFlight = true;
        restoreStatusMessage = null;
        renderCurrentState();

        try {
            const restorePremiumPurchase = getRestorePurchaseCallable();
            if (typeof window.BARK.incrementRequestCount === 'function') {
                window.BARK.incrementRequestCount();
            }
            const result = await restorePremiumPurchase({});
            const data = result && result.data ? result.data : {};
            const restoredActive = applyRestoredEntitlement(data.entitlement, user);
            if (restoredActive || data.restored === true) {
                restoreStatusMessage = null;
                clearCheckoutReturnState();
                renderCurrentState();
                return;
            }

            restoreStatusMessage = data.message || 'No active Lemon Squeezy subscription was found yet for this signed-in email. Wait a minute, then recheck before starting another checkout.';
        } catch (error) {
            console.error('[paywallController] restorePremiumPurchase failed:', error);
            restoreStatusMessage = 'Premium restore could not complete. Please try again in a moment or contact support with the email on this account.';
        } finally {
            restorePurchaseInFlight = false;
            renderCurrentState();
        }
    }

    function bindClick(id, handler) {
        const node = getElement(id);
        if (!node || node.dataset.paywallBound === 'true') return;
        node.dataset.paywallBound = 'true';
        node.addEventListener('click', handler);
    }

    function bindPremiumMapTools() {
        const premiumWrap = getElement('premium-filters-wrap');
        if (!premiumWrap || premiumWrap.dataset.paywallBound === 'true') return;
        premiumWrap.dataset.paywallBound = 'true';

        premiumWrap.addEventListener('click', (event) => {
            if (isPremiumActive()) return;
            const target = event.target;
            if (target && target.closest && target.closest('#premium-upgrade-btn')) return;
            event.preventDefault();
            const source = target && target.closest && target.closest('#toggle-virtual-trail, #toggle-completed-trails')
                ? 'virtual-trails'
                : target && target.closest && target.closest('#visited-filter, #map-style-select')
                    ? 'premium-map-filters'
                    : 'premium-map-tools';
            openPaywall({ source });
        }, true);
    }

    function bindAuthObserverWhenReady(attempt = 0) {
        if (typeof firebase === 'undefined' || !firebase.apps || firebase.apps.length === 0 || !firebase.auth) {
            if (attempt < 80) setTimeout(() => bindAuthObserverWhenReady(attempt + 1), 250);
            return;
        }

        try {
            firebase.auth().onAuthStateChanged(() => {
                renderCurrentState();
            });
        } catch (error) {
            if (attempt < 80) setTimeout(() => bindAuthObserverWhenReady(attempt + 1), 250);
        }
    }

    function subscribePremiumState() {
        const premiumService = getPremiumService();
        if (!premiumService || typeof premiumService.subscribe !== 'function' || unsubscribePremium) return;
        unsubscribePremium = premiumService.subscribe(() => {
            renderCurrentState();
        });
    }

    function initPaywall() {
        if (initialized) return;
        initialized = true;
        returnState = getReturnStateFromUrl();
        returnStateStartedAt = returnState ? Date.now() : null;
        const initialReturnState = returnState;

        bindClick('paywall-close-btn', closePaywall);
        bindClick('paywall-secondary-btn', closePaywall);
        bindClick('paywall-clear-url-btn', clearCheckoutParams);
        bindClick('paywall-restore-btn', restorePurchase);
        bindClick('paywall-primary-btn', startCheckout);
        bindClick('profile-premium-action', () => openPaywall({ source: 'profile-premium-card' }));
        bindClick('premium-upgrade-btn', () => openPaywall({ source: 'premium-map-tools' }));

        const overlay = getElement('paywall-overlay');
        if (overlay && overlay.dataset.paywallBound !== 'true') {
            overlay.dataset.paywallBound = 'true';
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) closePaywall();
            });
        }

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closePaywall();
        });

        bindPremiumMapTools();
        subscribePremiumState();
        bindAuthObserverWhenReady();
        renderCurrentState();

        if (initialReturnState === 'success' || initialReturnState === 'canceled') {
            openPaywall({ source: `checkout-${initialReturnState}` });
        }
    }

    window.BARK.paywall = {
        openPaywall,
        closePaywall,
        startCheckout,
        restorePurchase,
        clearCheckoutParams,
        renderCurrentState
    };
    window.BARK.initPaywall = initPaywall;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPaywall);
    } else {
        initPaywall();
    }
})();
