/**
 * feedbackTransport.js — everything the feedback modal sends, and nothing it draws.
 *
 * One submit press has two destinations:
 *   1. the submitFeedback callable, which files the report and relays it (plus any
 *      screenshots) to the right Discord channel — signed-in users only;
 *   2. a prefilled mailto the reporter can edit and send themselves, which is the
 *      only path available when signed out.
 *
 * They can disagree, because the email is editable after it opens. That is stated
 * in the Discord footer rather than pretended away.
 */
window.BARK = window.BARK || {};

(function () {
    // One address on our own domain; who actually reads it is a Cloudflare Email
    // Routing rule, so adding or changing readers never needs an app release. This
    // is the only place the address is written down: the park panel and the
    // profile portal build their fallback mailto links from feedbackMailto()
    // below rather than keeping copies that drift.
    const FEEDBACK_EMAILS = ['support@usbarkrangersmap.com'];
    const FEEDBACK_EMAIL = FEEDBACK_EMAILS.join(',');
    const MAX_MESSAGE_LENGTH = 2000;   // matches cleanFeedbackText in functions/index.js

    // What the reporter picks, and what the backend calls it. Backend types are
    // fixed by FEEDBACK_DISCORD_CHANNELS in functions/index.js, which is what
    // decides the channel; changing a mapping here reroutes the report.
    const TYPES = Object.freeze([
        { id: 'bug', label: 'Something is broken', short: 'Bug', emoji: '🐛', backendType: 'bug' },
        { id: 'correction', label: 'A place is wrong or missing', short: 'Map fix', emoji: '📍', backendType: 'other' },
        { id: 'idea', label: 'I have an idea', short: 'Idea', emoji: '💡', backendType: 'idea' },
        { id: 'support', label: 'I need help', short: 'Help', emoji: '🆘', backendType: 'support' }
    ]);

    const DEFAULT_TYPE_ID = 'bug';

    function getType(typeId) {
        return TYPES.find(type => type.id === typeId) || TYPES.find(type => type.id === DEFAULT_TYPE_ID);
    }

    // "Add a missing location" outranks the type buttons: it is the one report the
    // backend routes on subject rather than on what the reporter clicked.
    function resolveBackendType(typeId, subjectKind) {
        if (subjectKind === 'missing') return 'missing_location';
        return getType(typeId).backendType;
    }

    function clampMessage(message) {
        return String(message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    }

    function collectBrowserMetadata() {
        try {
            return {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                language: navigator.language,
                path: String(location.pathname || '/').split(/[?#]/, 1)[0] || '/',
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight
            };
        } catch (error) {
            return {};
        }
    }

    function appVersionLabel() {
        try {
            return window.BARK.getDisplayVersion();
        } catch (error) {
            return 'unknown';
        }
    }

    // The one place a mailto: for feedback is assembled, whoever is asking.
    function feedbackMailto(subject, body) {
        return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }

    /**
     * values: { typeId, subjectLabel, subjectKind, parkId, message, name, email, screenshotCount }
     * Returns { to, subject, body, url }.
     */
    function buildEmail(values) {
        const type = getType(values.typeId);
        const subjectLabel = values.subjectLabel || 'General feedback';
        const sender = [values.name, values.email].filter(Boolean).join(' · ');

        const header = [
            `Type: ${type.short}`,
            `About: ${subjectLabel}`,
            values.parkId ? `Place ID: ${values.parkId}` : null,
            sender ? `From: ${sender}` : null,
            `App: v${appVersionLabel()}`
        ].filter(Boolean);

        const footer = values.screenshotCount > 0
            ? [
                '',
                `(${values.screenshotCount} screenshot${values.screenshotCount === 1 ? '' : 's'} went with the in-app report.`,
                'Attach them here too if you would like them on this email.)'
            ]
            : ['', '(You can attach photos to this email before sending.)'];

        const body = header
            .concat(['', '---', '', clampMessage(values.message)])
            .concat(footer)
            .join('\n');

        const subject = `B.A.R.K. ${type.short}: ${subjectLabel}`;

        return { to: FEEDBACK_EMAIL, subject, body, url: feedbackMailto(subject, body) };
    }

    function getCallable() {
        if (typeof firebase === 'undefined' || typeof firebase.functions !== 'function') {
            const error = new Error('Firebase Functions SDK is not available.');
            error.code = 'unavailable';
            throw error;
        }
        return firebase.functions().httpsCallable('submitFeedback');
    }

    function getSignedInUser() {
        try {
            return (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * values as in buildEmail, plus screenshots: [{ name, mimeType, dataBase64 }].
     * Resolves to the callable's result. Throws for the caller to describe.
     */
    async function submitToBackend(values) {
        const callable = getCallable();
        const response = await callable({
            message: clampMessage(values.message),
            type: resolveBackendType(values.typeId, values.subjectKind),
            subject: values.subjectLabel || null,
            parkId: values.parkId || null,
            screenshots: Array.isArray(values.screenshots) ? values.screenshots : [],
            // Only read when there is no auth token to trust instead. A signed-in
            // reporter's identity comes from the token, server-side.
            contactName: values.name || null,
            contactEmail: values.email || null,
            // Which entry point produced this, so it is possible to see whether
            // reports come from the map pins or the profile portal.
            surface: values.surface || null,
            browser: collectBrowserMetadata()
        });
        return (response && response.data) || { ok: true };
    }

    window.BARK.feedbackTransport = {
        TYPES,
        DEFAULT_TYPE_ID,
        MAX_MESSAGE_LENGTH,
        FEEDBACK_EMAIL,
        FEEDBACK_EMAILS,
        getType,
        resolveBackendType,
        feedbackMailto,
        buildEmail,
        submitToBackend,
        getSignedInUser,
        collectBrowserMetadata
    };
})();
