/**
 * authAccountUi.js - Public account UI for Google and Email/Password auth.
 *
 * Premium state remains read-only from Firestore entitlement via premiumService.
 */
(function () {
    window.BARK = window.BARK || {};
    window.BARK.services = window.BARK.services || {};

    const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const MIN_PASSWORD_LENGTH = 8;
    const MIN_USERNAME_LENGTH = 2;
    const MAX_USERNAME_LENGTH = 30;
    const SUPPORT_EMAIL = 'usbarkrangers@gmail.com';
    const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
    const BILLING_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
    const BILLING_RETURN_SYNC_MIN_INTERVAL_MS = 5 * 1000;
    const BILLING_FIX_BUILD = 'billing-fix-build: 2026-05-11-1345';
    const LEMON_SQUEEZY_STORE_HOST = 'usbarkrangers.lemonsqueezy.com';
    const TEST_MODE_PORTAL_UNAVAILABLE_MESSAGE = 'Customer portal is unavailable while the Lemon Squeezy store is not activated. Manage this test subscription from the Lemon Squeezy dashboard.';

    console.log(BILLING_FIX_BUILD);
    window.BARK.billingFixBuild = BILLING_FIX_BUILD;

    let initialized = false;
    let activeMode = 'signin';
    let unsubscribePremium = null;
    let lastVerificationEmailSentAt = 0;
    let lastBillingSyncKey = '';
    let lastBillingSyncAt = 0;
    let lastBillingReturnSyncAt = 0;

    const ACCOUNT_PROMPT_COPY = {
        'mark-visited': {
            title: "Create a free account to save where you've been",
            body: 'Mark parks visited, keep your B.A.R.K. passport backed up, and pick up on any device.',
            source: 'mark visited'
        },
        'verified-checkin': {
            title: 'Create a free account to save verified check-ins',
            body: 'Verified visits earn points and stay attached to your profile only after you sign in.',
            source: 'verified check-in'
        },
        'saved-route': {
            title: 'Sign in to upgrade and save this trip',
            body: 'Saved routes are a Premium feature. Sign in so Premium can be attached to your B.A.R.K. Ranger account.',
            source: 'saved route'
        },
        'load-route': {
            title: 'Sign in to upgrade and load saved trips',
            body: 'Saved routes are a Premium feature. Sign in to upgrade, then reopen trips from any device.',
            source: 'load route'
        },
        expedition: {
            title: 'Create a free account to track walks',
            body: 'Walk miles, virtual expeditions, and completed trails are saved to your B.A.R.K. profile.',
            source: 'expedition'
        },
        profile: {
            title: 'Create a free account to unlock your profile',
            body: 'Your visited parks, stats, and achievements live in your account. Saved trips require Premium.',
            source: 'profile'
        },
        default: {
            title: "Create a free account to save where you've been",
            body: 'Your B.A.R.K. passport, visited parks, and verified check-ins stay with your account. Saved trips require Premium.',
            source: 'map'
        }
    };

    function getElement(id) {
        return document.getElementById(id);
    }

    function getFirebaseAuth() {
        if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') {
            throw new Error('Firebase Auth is not available yet.');
        }
        return firebase.auth();
    }

    function getPremiumService() {
        return window.BARK.services && window.BARK.services.premium;
    }

    function requestGoogleAccountChooser() {
        const authService = window.BARK.services && window.BARK.services.auth;
        if (authService && typeof authService.requestGoogleAccountChooser === 'function') {
            authService.requestGoogleAccountChooser();
            return;
        }

        window.BARK.auth = window.BARK.auth || {};
        window.BARK.auth.forceGoogleAccountChooserOnNextSignIn = true;
    }

    function setText(id, text) {
        const node = getElement(id);
        if (node) node.textContent = text;
    }

    function setHidden(id, hidden) {
        const node = getElement(id);
        if (node) node.hidden = hidden === true;
    }

    function setButtonTextAndDisabled(id, text, disabled) {
        const node = getElement(id);
        if (!node) return;
        node.textContent = text;
        node.disabled = disabled === true;
    }

    function setStatus(message, tone = 'neutral') {
        const node = getElement('account-auth-message');
        if (!node) return;
        node.textContent = message || '';
        node.dataset.tone = tone;
        node.hidden = !message;
    }

    function getAccountPromptCopy(source) {
        return ACCOUNT_PROMPT_COPY[source] || ACCOUNT_PROMPT_COPY.default;
    }

    function closeAccountPrompt() {
        const overlay = getElement('account-gate-overlay');
        if (!overlay) return;
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
    }

    function focusAccountForm(mode) {
        closeAccountPrompt();
        const profileTab = document.querySelector('.nav-item[data-target="profile-view"]');
        if (profileTab) profileTab.click();

        setTimeout(() => {
            showMode(mode || 'create', { focus: false });
            const loginContainer = getElement('login-container');
            const target = getAccountFormFocusTarget(mode || 'create');
            const googleBtn = getElement('google-login-btn');
            if (loginContainer) loginContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (target) target.focus({ preventScroll: true });
            else if (googleBtn) googleBtn.focus({ preventScroll: true });
        }, 120);
    }

    function openAccountPrompt(options = {}) {
        const overlay = getElement('account-gate-overlay');
        if (!overlay) {
            focusAccountForm(options.mode || 'create');
            return;
        }

        const copy = getAccountPromptCopy(options.source || 'default');
        setText('account-gate-eyebrow', 'Free account');
        setText('account-gate-title', copy.title);
        setText('account-gate-body', copy.body);
        setText('account-gate-source', `Opened from ${copy.source}`);
        overlay.classList.add('active');
        overlay.setAttribute('aria-hidden', 'false');

        const primary = getElement('account-gate-primary-btn');
        if (primary) primary.focus({ preventScroll: true });
    }

    function cleanEmail(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function cleanUsername(value) {
        return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    }

    function readPassword(id) {
        const input = getElement(id);
        return input && typeof input.value === 'string' ? input.value : '';
    }

    function validateUsername(username) {
        if (username.length < MIN_USERNAME_LENGTH) {
            return `Choose a username with at least ${MIN_USERNAME_LENGTH} characters.`;
        }
        if (username.length > MAX_USERNAME_LENGTH) {
            return `Keep your username to ${MAX_USERNAME_LENGTH} characters or fewer.`;
        }
        if (/[\r\n<>]/.test(username)) {
            return 'Use a username without angle brackets or line breaks.';
        }
        return null;
    }

    function validateEmail(email) {
        if (!EMAIL_PATTERN.test(email)) {
            return 'Enter a valid email address.';
        }
        return null;
    }

    function validatePassword(password) {
        if (password.length < MIN_PASSWORD_LENGTH) {
            return `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
        }
        return null;
    }

    function getSafeAuthError(error) {
        const code = error && error.code ? String(error.code) : '';
        switch (code) {
            case 'auth/email-already-in-use':
                return 'That email already has a B.A.R.K. account. Sign in, use Continue with Google, or reset your password.';
            case 'auth/invalid-email':
                return 'Enter a valid email address.';
            case 'auth/weak-password':
                return `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
            case 'auth/user-not-found':
            case 'auth/wrong-password':
            case 'auth/invalid-login-credentials':
            case 'auth/invalid-credential':
                return 'Email or password did not match.';
            case 'auth/operation-not-allowed':
                return 'Email/password sign-in is not enabled yet. Enable it in Firebase Console and try again.';
            case 'auth/too-many-requests':
                return 'Too many attempts. Wait a moment, then try again.';
            case 'auth/network-request-failed':
                return 'Network error. Check your connection and try again.';
            case 'auth/popup-closed-by-user':
                return 'Google sign-in was canceled.';
            default:
                return 'Sign-in could not be completed. Please try again.';
        }
    }

    function getProviderLabel(user) {
        const providerIds = (user && Array.isArray(user.providerData) ? user.providerData : [])
            .map(provider => provider && provider.providerId)
            .filter(Boolean);

        if (providerIds.includes('google.com') && providerIds.includes('password')) {
            return 'Google and email/password';
        }
        if (providerIds.includes('google.com')) return 'Google';
        if (providerIds.includes('password')) return 'Email/password';
        return user && user.isAnonymous ? 'Anonymous' : 'Firebase Auth';
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

    function getVerificationCooldownRemainingMs(now = Date.now()) {
        if (!lastVerificationEmailSentAt) return 0;
        return Math.max(0, VERIFICATION_RESEND_COOLDOWN_MS - (now - lastVerificationEmailSentAt));
    }

    function updateEmailVerificationPanel(user) {
        const panel = getElement('account-email-verification-panel');
        if (!panel) return;

        const showPanel = needsEmailVerification(user);
        panel.hidden = !showPanel;
        if (!showPanel) {
            setButtonTextAndDisabled('account-resend-verification-btn', 'Resend verification email', false);
            return;
        }

        const cooldownRemainingMs = getVerificationCooldownRemainingMs();
        const cooldownSeconds = Math.ceil(cooldownRemainingMs / 1000);
        setText('account-email-verification-eyebrow', 'Please verify your email');
        setText('account-email-verification-title', lastVerificationEmailSentAt ? 'Email verification sent' : 'Please verify your email');
        setText('account-email-verification-copy', 'Please verify your email before using Premium checkout, coupons, or premium routing.');
        setButtonTextAndDisabled(
            'account-resend-verification-btn',
            cooldownRemainingMs > 0 ? `Resend in ${cooldownSeconds}s` : 'Resend verification email',
            cooldownRemainingMs > 0
        );
        setButtonTextAndDisabled('account-refresh-verification-btn', 'I verified, refresh status', false);
    }

    function getUserDisplayName(user) {
        return cleanUsername(user && user.displayName) || 'Bark Ranger';
    }

    function getPremiumLabel() {
        const premiumService = getPremiumService();
        if (!premiumService || typeof premiumService.getEntitlement !== 'function') {
            return 'Loading';
        }

        const entitlement = premiumService.getEntitlement();
        if (entitlement.status === 'access_code_active' && entitlement.source === 'access_code' && premiumService.isPremium && premiumService.isPremium()) {
            return 'Free Premium Access';
        }
        if (entitlement.status === 'access_code_expired') return 'Free Premium access ended';
        if (entitlement.status === 'past_due') return 'Premium past due';
        if (entitlement.status === 'cancelled_active') return 'Premium active until period end';
        if (premiumService.isPremium && premiumService.isPremium()) {
            return entitlement.status === 'manual_active' ? 'Premium active (manual)' : 'Premium active';
        }
        if (entitlement.status === 'expired') return 'Premium expired';
        if (entitlement.status === 'canceled') return 'Premium canceled';
        if (entitlement.status === 'refunded') return 'Premium refunded';
        return 'Free';
    }

    function isLemonSqueezyEntitlement(entitlement) {
        return Boolean(
            entitlement &&
            (
                entitlement.source === 'lemon_squeezy' ||
                entitlement.providerCustomerId ||
                entitlement.providerSubscriptionId
            )
        );
    }

    function formatEntitlementDate(value) {
        if (!value) return 'not set';
        let date = null;
        if (typeof value === 'number') date = new Date(value);
        else if (typeof value === 'string') date = new Date(value);
        else if (value instanceof Date) date = value;
        else if (typeof value.toMillis === 'function') date = new Date(value.toMillis());
        else if (Number.isFinite(Number(value.seconds))) {
            date = new Date((Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1000000));
        }
        if (!date || Number.isNaN(date.getTime())) return 'not set';
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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

    function getBillingPanelState(user) {
        const premiumService = getPremiumService();
        const entitlement = premiumService && typeof premiumService.getEntitlement === 'function'
            ? premiumService.getEntitlement()
            : null;
        const isPremium = premiumService && typeof premiumService.isPremium === 'function'
            ? premiumService.isPremium()
            : false;
        const hasInactiveLemonSubscription = isLemonSqueezyEntitlement(entitlement) &&
            ['expired', 'canceled', 'refunded'].includes(entitlement.status);

        if (!user || (!isPremium && !hasInactiveLemonSubscription)) {
            return { visible: false };
        }

        if (entitlement && entitlement.source === 'access_code') {
            if (isPremium && entitlement.status === 'access_code_active') {
                return {
                    visible: true,
                    mode: 'access-code',
                    eyebrow: 'SUBSCRIPTION',
                    title: getAccessCodeAudienceLabel(entitlement.accessCodeAudience),
                    copy: `Access ends: ${formatEntitlementDate(entitlement.expiresAt)}. Auto-renew: No. Payment method: None.`,
                    hideButton: true
                };
            }

            if (entitlement.status === 'access_code_expired') {
                return {
                    visible: true,
                    mode: 'access-code-expired',
                    eyebrow: 'SUBSCRIPTION',
                    title: 'Free Premium access ended',
                    copy: 'Subscribe through Lemon Squeezy to continue Premium.',
                    hideButton: true
                };
            }
        }

        if (isLemonSqueezyEntitlement(entitlement)) {
            let statusText = 'Active';
            const renewalDate = formatEntitlementDate(entitlement.currentPeriodEnd);
            let copy = renewalDate === 'not set' ? 'Auto-renew is active' : `Auto-renews ${renewalDate}`;
            let buttonText = 'Manage';
            if (entitlement.status === 'past_due') {
                statusText = 'Payment retry in progress';
                copy = 'Premium stays active while Lemon Squeezy retries.';
            } else if (entitlement.status === 'cancelled_active') {
                statusText = 'Premium cancelled';
                copy = `Access ends: ${formatEntitlementDate(entitlement.currentPeriodEnd || entitlement.endsAt)} · Auto-renew: No`;
            } else if (entitlement.status === 'refunded') {
                statusText = 'Subscription refunded';
                copy = 'Premium is inactive after a refund. Contact support if this looks wrong.';
                buttonText = 'Manage subscription';
            } else if (entitlement.status === 'canceled' || entitlement.status === 'expired') {
                statusText = 'Premium inactive';
                copy = 'Premium is inactive. Subscribe again or contact support if this looks wrong.';
                buttonText = 'Manage subscription';
            }
            return {
                visible: true,
                mode: 'portal',
                eyebrow: 'SUBSCRIPTION',
                title: statusText,
                copy,
                buttonText,
                buttonMode: 'portal'
            };
        }

        return {
            visible: true,
            mode: 'support',
            eyebrow: 'SUBSCRIPTION',
            title: 'Managed by support',
            copy: 'This account has a manual premium grant, so there is no Lemon Squeezy subscription to manage.',
            buttonText: 'Contact support',
            buttonMode: 'support',
            url: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('B.A.R.K. Premium support')}`
        };
    }

    function refreshBillingPanel(user, options = {}) {
        const panel = getElement('account-billing-panel');
        const button = getElement('account-manage-subscription-btn');
        if (!panel || !button) return;

        const state = getBillingPanelState(user);
        panel.hidden = !state.visible;
        if (!state.visible) {
            delete button.dataset.billingUrl;
            delete button.dataset.mode;
            button.hidden = false;
            return;
        }

        setText('account-billing-eyebrow', state.eyebrow);
        setText('account-billing-title', state.title);
        setText('account-billing-copy', state.copy);
        button.hidden = false;
        button.hidden = state.hideButton === true;
        if (state.hideButton === true) {
            delete button.dataset.billingUrl;
            delete button.dataset.mode;
            return;
        }
        button.textContent = state.buttonText;
        button.dataset.mode = state.buttonMode;
        if (state.url) {
            button.dataset.billingUrl = state.url;
        } else {
            delete button.dataset.billingUrl;
        }
        maybeSyncBillingPanelFromProvider(user, {
            force: options.forceBillingSync === true
        });
    }

    function getCustomerPortalCallable() {
        if (typeof firebase === 'undefined' || typeof firebase.functions !== 'function') return null;
        return firebase.functions().httpsCallable('getCustomerPortalUrl');
    }

    function applySyncedEntitlement(entitlement, user, reason) {
        if (!entitlement || typeof entitlement !== 'object') return;
        const premiumService = getPremiumService();
        if (!premiumService || typeof premiumService.setEntitlement !== 'function') return;
        try {
            premiumService.setEntitlement(entitlement, {
                uid: user && user.uid ? user.uid : null,
                reason
            });
        } catch (error) {
            console.warn('[authAccountUi] billing entitlement sync failed:', error);
        }
    }

    function maybeSyncBillingPanelFromProvider(user, options = {}) {
        const premiumService = getPremiumService();
        const entitlement = premiumService && typeof premiumService.getEntitlement === 'function'
            ? premiumService.getEntitlement()
            : null;
        if (!user || !entitlement || entitlement.source !== 'lemon_squeezy') return;
        if (!entitlement.providerSubscriptionId) return;

        const now = Date.now();
        const syncKey = `${user.uid}:${entitlement.providerSubscriptionId}:${entitlement.status}`;
        if (options.force !== true && syncKey === lastBillingSyncKey && now - lastBillingSyncAt < BILLING_SYNC_COOLDOWN_MS) return;
        lastBillingSyncKey = syncKey;
        lastBillingSyncAt = now;

        const getCustomerPortalUrl = getCustomerPortalCallable();
        if (!getCustomerPortalUrl) return;
        getCustomerPortalUrl({ syncOnly: true })
            .then((result) => {
                const syncedEntitlement = result && result.data && result.data.entitlement;
                applySyncedEntitlement(syncedEntitlement, user, 'billing-panel-sync');
            })
            .catch((error) => {
                console.warn('[authAccountUi] background billing sync failed:', error);
            });
    }

    function validateSubscriptionDestination(value) {
        if (typeof value !== 'string' || !value.trim()) return '';
        try {
            const url = new URL(value, window.location.href);
            return (url.protocol === 'https:' || url.protocol === 'mailto:') ? url.toString() : '';
        } catch (error) {
            return '';
        }
    }

    function validateBillingPortalDestination(value) {
        if (typeof value !== 'string' || !value.trim()) {
            throw new Error('No customer portal is available for this subscription.');
        }

        let url;
        try {
            url = new URL(value, window.location.href);
        } catch (error) {
            throw new Error('No customer portal is available for this subscription.');
        }

        const pathname = url.pathname || '/';
        const isRootPath = pathname === '/' || pathname.trim() === '';
        if (url.protocol !== 'https:' || isRootPath) {
            throw new Error('Billing portal returned an invalid store URL. Please contact support.');
        }
        if (url.hostname === LEMON_SQUEEZY_STORE_HOST && isRootPath) {
            throw new Error('Billing portal returned an invalid store URL. Please contact support.');
        }

        return url.toString();
    }

    function isUnavailableLemonTestPortal(value) {
        if (typeof value !== 'string' || !value.trim()) return false;
        try {
            const url = new URL(value, window.location.href);
            const normalizedPathname = (url.pathname || '/').replace(/\/+$/, '') || '/';
            return url.hostname === LEMON_SQUEEZY_STORE_HOST &&
                normalizedPathname === '/billing' &&
                url.searchParams.has('test_mode');
        } catch (error) {
            return false;
        }
    }

    function getSubscriptionManagementErrorMessage(error) {
        const message = error && typeof error.message === 'string' ? error.message : '';
        if (/Billing portal returned an invalid store URL\. Please contact support\./i.test(message)) {
            return 'Billing portal returned an invalid store URL. Please contact support.';
        }
        if (/No active subscription was found for this account\./i.test(message)) {
            return 'No active subscription was found for this account.';
        }
        if (/No customer portal is available for this subscription\./i.test(message)) {
            return 'No customer portal is available for this subscription.';
        }
        if (/Please sign in first\./i.test(message)) {
            return 'Please sign in first.';
        }
        return 'Subscription management could not open. Please contact support.';
    }

    async function openSubscriptionManagement() {
        const button = getElement('account-manage-subscription-btn');
        if (!button || !button.dataset.mode) return;

        if (button.dataset.mode !== 'portal') {
            const destination = typeof button.dataset.billingUrl === 'string' ? button.dataset.billingUrl : '';
            try {
                const safeDestination = validateSubscriptionDestination(destination);
                if (!safeDestination) {
                    throw new Error('Unsupported billing URL protocol.');
                }
                window.location.assign(safeDestination);
            } catch (error) {
                console.error('[authAccountUi] manage subscription URL failed:', error);
                setStatus('Subscription management could not open. Please contact support.', 'error');
            }
            return;
        }

        try {
            const currentUser = typeof firebase !== 'undefined' && typeof firebase.auth === 'function'
                ? firebase.auth().currentUser
                : null;
            if (!currentUser) {
                throw new Error('Please sign in first.');
            }

            const getCustomerPortalUrl = getCustomerPortalCallable();
            if (!getCustomerPortalUrl) {
                throw new Error('Subscription management could not open.');
            }

            button.disabled = true;
            setStatus('Opening secure billing portal...', 'neutral');
            if (typeof window.BARK.incrementRequestCount === 'function') window.BARK.incrementRequestCount();

            const result = await getCustomerPortalUrl({});
            console.log('[Billing] getCustomerPortalUrl response:', result);
            const data = result && result.data ? result.data : {};
            const signedUrl = data.url || data.customerPortalUrl;
            console.log('[Billing] Customer portal URL returned:', signedUrl);
            if (typeof window.alert === 'function') {
                window.alert('Billing portal URL:\n' + signedUrl);
            }
            applySyncedEntitlement(data.entitlement, currentUser, 'billing-portal-sync');

            if (isUnavailableLemonTestPortal(signedUrl)) {
                setStatus(TEST_MODE_PORTAL_UNAVAILABLE_MESSAGE, 'error');
                return;
            }

            const safeDestination = validateBillingPortalDestination(signedUrl);
            window.location.assign(safeDestination);
        } catch (error) {
            console.error('[authAccountUi] manage subscription URL failed:', error);
            setStatus(getSubscriptionManagementErrorMessage(error), 'error');
        } finally {
            button.disabled = false;
        }
    }

    function updateModeButtons() {
        ['signin', 'create', 'reset'].forEach(mode => {
            const button = getElement(`account-mode-${mode}`);
            if (!button) return;
            button.classList.toggle('active', activeMode === mode);
            button.setAttribute('aria-pressed', activeMode === mode ? 'true' : 'false');
        });
    }

    function getAccountFormFocusTarget(mode) {
        if (mode === 'reset') return getElement('account-reset-email');
        if (mode === 'create') return getElement('account-create-username');
        return getElement('account-signin-email');
    }

    function showMode(mode, options = {}) {
        activeMode = ['signin', 'create', 'reset'].includes(mode) ? mode : 'signin';
        setHidden('account-signin-form', activeMode !== 'signin');
        setHidden('account-create-form', activeMode !== 'create');
        setHidden('account-reset-form', activeMode !== 'reset');
        updateModeButtons();
        setStatus('', 'neutral');

        if (options.focus === false) return;
        const target = getAccountFormFocusTarget(activeMode);
        if (target) target.focus({ preventScroll: true });
    }

    function clearPasswordFields() {
        ['account-signin-password', 'account-create-password'].forEach(id => {
            const input = getElement(id);
            if (input) input.value = '';
        });
    }

    function refreshAccountDisplay(options = {}) {
        let user = null;
        try {
            user = getFirebaseAuth().currentUser;
        } catch (error) {
            user = null;
        }

        const signedIn = Boolean(user);
        setHidden('account-status-card', !signedIn);
        updateEmailVerificationPanel(user);
        refreshBillingPanel(user, {
            forceBillingSync: options.forceBillingSync === true
        });

        if (!signedIn) return;

        setText('account-display-name', getUserDisplayName(user));
        setText('account-display-email', user.email || 'No email on this account');
        setText('account-display-uid', user.uid || 'Unavailable');
        setText('account-display-provider', getProviderLabel(user));
        setText('account-display-premium', getPremiumLabel());
    }

    function refreshBillingStateAfterExternalReturn() {
        const now = Date.now();
        if (now - lastBillingReturnSyncAt < BILLING_RETURN_SYNC_MIN_INTERVAL_MS) return;
        lastBillingReturnSyncAt = now;
        refreshAccountDisplay({ forceBillingSync: true });
    }

    async function persistEmailVerificationState(user) {
        if (!user || !user.uid) return;
        try {
            if (typeof firebase === 'undefined' || !firebase.firestore) return;
            const timestamp = getServerTimestamp();
            await firebase.firestore().collection('users').doc(user.uid).set({
                emailVerified: user.emailVerified === true,
                emailVerificationUpdatedAt: timestamp || Date.now()
            }, { merge: true });
        } catch (error) {
            console.warn('[authAccountUi] email verification state save failed:', error);
        }
    }

    async function refreshEmailVerificationStatus(options = {}) {
        let user = null;
        try {
            user = getFirebaseAuth().currentUser;
        } catch (error) {
            user = null;
        }

        if (!user) {
            refreshAccountDisplay();
            return null;
        }

        if (options.reload !== false && typeof user.reload === 'function') {
            try {
                await user.reload();
                user = getFirebaseAuth().currentUser || user;
            } catch (error) {
                console.warn('[authAccountUi] email verification reload failed:', error);
            }
        }

        if (user.emailVerified === true && typeof user.getIdToken === 'function') {
            try {
                await user.getIdToken(true);
            } catch (error) {
                console.warn('[authAccountUi] email verification token refresh failed:', error);
            }
        }

        if (options.persist === true) {
            await persistEmailVerificationState(user);
        }
        refreshAccountDisplay();

        if (options.silent !== true) {
            setStatus(user.emailVerified === true
                ? 'Email verified. Premium account actions are available.'
                : 'Please verify your email, then refresh status.',
                user.emailVerified === true ? 'success' : 'neutral');
        }

        return user;
    }

    async function sendVerificationEmailForUser(user, options = {}) {
        if (!user || !needsEmailVerification(user)) return false;

        const cooldownRemainingMs = options.ignoreCooldown === true ? 0 : getVerificationCooldownRemainingMs();
        if (cooldownRemainingMs > 0) {
            setStatus(`Please wait ${Math.ceil(cooldownRemainingMs / 1000)} seconds before resending verification email.`, 'neutral');
            updateEmailVerificationPanel(user);
            return false;
        }

        if (typeof user.sendEmailVerification !== 'function') {
            setStatus('Email verification could not be sent from this browser. Please sign out and sign in again.', 'error');
            return false;
        }

        try {
            await user.sendEmailVerification();
            lastVerificationEmailSentAt = Date.now();
            setStatus('Email verification sent. Please verify your email.', 'success');
            await persistEmailVerificationState(user);
            updateEmailVerificationPanel(user);
            return true;
        } catch (error) {
            console.error('[authAccountUi] sendEmailVerification failed:', error);
            setStatus(error && error.code === 'auth/too-many-requests'
                ? 'Too many verification emails. Wait a moment, then try again.'
                : 'Verification email could not be sent. Please try again.',
                'error');
            return false;
        }
    }

    async function resendVerificationEmail() {
        const user = getFirebaseAuth().currentUser;
        await sendVerificationEmailForUser(user);
    }

    function seedAccountEmailFields(email) {
        if (!email) return;
        ['account-signin-email', 'account-reset-email'].forEach(id => {
            const input = getElement(id);
            if (input) input.value = email;
        });
    }

    function clearCreateUsernameField() {
        const input = getElement('account-create-username');
        if (input) input.value = '';
    }

    function getServerTimestamp() {
        if (typeof firebase === 'undefined' || !firebase.firestore || !firebase.firestore.FieldValue) return null;

        try {
            return firebase.firestore.FieldValue.serverTimestamp();
        } catch (error) {
            return null;
        }
    }

    async function saveCreatedAccountProfile(user, username, email) {
        if (!user) return;

        if (typeof user.updateProfile === 'function') {
            try {
                await user.updateProfile({ displayName: username });
            } catch (error) {
                console.warn('[authAccountUi] updateProfile displayName failed:', error);
            }
        }

        try {
            if (typeof firebase === 'undefined' || !firebase.firestore) return;
            if (typeof window.BARK.incrementRequestCount === 'function') window.BARK.incrementRequestCount();

            const timestamp = getServerTimestamp();
            const profilePayload = {
                displayName: username,
                username,
                email: user.email || email || '',
                profileUpdatedAt: timestamp || Date.now()
            };
            if (timestamp) profilePayload.createdAt = timestamp;

            await firebase.firestore().collection('users').doc(user.uid).set(profilePayload, { merge: true });
        } catch (error) {
            console.warn('[authAccountUi] user profile seed failed:', error);
        }

        setText('user-profile-name', username);
        setText('account-display-name', username);
    }

    async function createAccount(event) {
        event.preventDefault();
        const username = cleanUsername(getElement('account-create-username') && getElement('account-create-username').value);
        const email = cleanEmail(getElement('account-create-email') && getElement('account-create-email').value);
        const password = readPassword('account-create-password');
        const validationError = validateUsername(username) || validateEmail(email) || validatePassword(password);
        if (validationError) {
            setStatus(validationError, 'error');
            return;
        }

        try {
            setStatus('Creating account...', 'neutral');
            const auth = getFirebaseAuth();
            const credential = await auth.createUserWithEmailAndPassword(email, password);
            const user = (credential && credential.user) || auth.currentUser;
            await saveCreatedAccountProfile(user, username, email);
            const verificationSent = await sendVerificationEmailForUser(user, { ignoreCooldown: true });
            clearPasswordFields();
            clearCreateUsernameField();
            if (!verificationSent) {
                setStatus('Account created. Please verify your email before using Premium checkout or coupons.', 'success');
            }
            refreshAccountDisplay();
        } catch (error) {
            console.error('[authAccountUi] createUserWithEmailAndPassword failed:', error);
            if (error && error.code === 'auth/email-already-in-use') seedAccountEmailFields(email);
            setStatus(getSafeAuthError(error), 'error');
        }
    }

    async function signInWithEmail(event) {
        event.preventDefault();
        const email = cleanEmail(getElement('account-signin-email') && getElement('account-signin-email').value);
        const password = readPassword('account-signin-password');
        const validationError = validateEmail(email) || (password ? null : 'Enter your password.');
        if (validationError) {
            setStatus(validationError, 'error');
            return;
        }

        try {
            setStatus('Signing in...', 'neutral');
            const auth = getFirebaseAuth();
            await auth.signInWithEmailAndPassword(email, password);
            const user = await refreshEmailVerificationStatus({ reload: true, silent: true });
            clearPasswordFields();
            if (needsEmailVerification(user)) {
                setStatus('Please verify your email before using Premium checkout, coupons, or premium routing.', 'neutral');
            } else {
                setStatus('Signed in.', 'success');
            }
        } catch (error) {
            console.error('[authAccountUi] signInWithEmailAndPassword failed:', error);
            setStatus(getSafeAuthError(error), 'error');
        }
    }

    async function sendPasswordReset(event) {
        event.preventDefault();
        const email = cleanEmail(getElement('account-reset-email') && getElement('account-reset-email').value);
        const validationError = validateEmail(email);
        if (validationError) {
            setStatus(validationError, 'error');
            return;
        }

        try {
            setStatus('Sending reset email...', 'neutral');
            await getFirebaseAuth().sendPasswordResetEmail(email);
            setStatus('If this email has a B.A.R.K. password account, a reset link will arrive shortly. Google accounts should use Continue with Google.', 'success');
        } catch (error) {
            console.error('[authAccountUi] sendPasswordResetEmail failed:', error);
            setStatus(getSafeAuthError(error), 'error');
        }
    }

    async function signOut(options = {}) {
        try {
            await getFirebaseAuth().signOut();
            if (options.switchAccount) requestGoogleAccountChooser();
            clearPasswordFields();
            clearCreateUsernameField();
            setStatus(options.switchAccount ? 'Signed out. Choose another account.' : 'Signed out.', 'success');
            showMode('signin');
            const loginContainer = getElement('login-container');
            if (loginContainer) loginContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (error) {
            console.error('[authAccountUi] signOut failed:', error);
            setStatus('Sign-out could not be completed. Please try again.', 'error');
        }
    }

    function bindClick(id, handler) {
        const node = getElement(id);
        if (!node || node.dataset.accountBound === 'true') return;
        node.dataset.accountBound = 'true';
        node.addEventListener('click', handler);
    }

    function bindSubmit(id, handler) {
        const node = getElement(id);
        if (!node || node.dataset.accountBound === 'true') return;
        node.dataset.accountBound = 'true';
        node.addEventListener('submit', handler);
    }

    function subscribePremiumState() {
        const premiumService = getPremiumService();
        if (!premiumService || typeof premiumService.subscribe !== 'function' || unsubscribePremium) return;
        unsubscribePremium = premiumService.subscribe(refreshAccountDisplay);
    }

    function bindAuthObserverWhenReady(attempt = 0) {
        if (typeof firebase === 'undefined' || !firebase.apps || firebase.apps.length === 0 || !firebase.auth) {
            if (attempt < 80) setTimeout(() => bindAuthObserverWhenReady(attempt + 1), 250);
            return;
        }

        try {
            firebase.auth().onAuthStateChanged(async () => {
                await refreshEmailVerificationStatus({ reload: true, silent: true });
            });
            refreshEmailVerificationStatus({ reload: true, silent: true });
        } catch (error) {
            if (attempt < 80) setTimeout(() => bindAuthObserverWhenReady(attempt + 1), 250);
        }
    }

    function initAuthAccountUi() {
        if (initialized) return;
        initialized = true;

        bindClick('account-mode-signin', () => showMode('signin'));
        bindClick('account-mode-create', () => showMode('create'));
        bindClick('account-mode-reset', () => showMode('reset'));
        bindClick('account-forgot-password-btn', () => showMode('reset'));
        bindClick('account-inline-create-btn', () => showMode('create'));
        bindClick('account-signout-btn', () => signOut());
        bindClick('account-switch-btn', () => signOut({ switchAccount: true }));
        bindClick('account-manage-subscription-btn', openSubscriptionManagement);
        bindClick('account-gate-close-btn', closeAccountPrompt);
        bindClick('account-gate-primary-btn', () => focusAccountForm('create'));
        bindClick('account-gate-secondary-btn', () => focusAccountForm('signin'));
        bindClick('account-resend-verification-btn', resendVerificationEmail);
        bindClick('account-refresh-verification-btn', () => refreshEmailVerificationStatus({ reload: true, persist: true }));

        bindSubmit('account-signin-form', signInWithEmail);
        bindSubmit('account-create-form', createAccount);
        bindSubmit('account-reset-form', sendPasswordReset);

        const accountGateOverlay = getElement('account-gate-overlay');
        if (accountGateOverlay && accountGateOverlay.dataset.accountOverlayBound !== 'true') {
            accountGateOverlay.dataset.accountOverlayBound = 'true';
            accountGateOverlay.addEventListener('click', (event) => {
                if (event.target === accountGateOverlay) closeAccountPrompt();
            });
        }

        document.addEventListener('keydown', (event) => {
            const overlay = getElement('account-gate-overlay');
            if (event.key === 'Escape' && overlay && overlay.classList.contains('active')) {
                closeAccountPrompt();
            }
        });

        if (typeof window.addEventListener === 'function') {
            window.addEventListener('focus', refreshBillingStateAfterExternalReturn);
        }
        if (document && typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', () => {
                if (document.hidden === false) refreshBillingStateAfterExternalReturn();
            });
        }

        showMode('signin', { focus: false });
        subscribePremiumState();
        bindAuthObserverWhenReady();
    }

    window.BARK.authAccountUi = {
        initAuthAccountUi,
        showMode,
        openAccountPrompt,
        closeAccountPrompt,
        refreshAccountDisplay,
        refreshEmailVerificationStatus,
        resendVerificationEmail,
        needsEmailVerification,
        signOut,
        openSubscriptionManagement
    };
    window.BARK.initAuthAccountUi = initAuthAccountUi;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuthAccountUi);
    } else {
        initAuthAccountUi();
    }
})();
