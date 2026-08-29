/**
 * rateLimitUi.js — one readable warning for every callable rate limit.
 * Firebase supplies an absolute ISO reset timestamp; the browser renders it in
 * the ranger's own time zone instead of showing server time or raw seconds.
 */
(function () {
    window.BARK = window.BARK || {};
    let lastWarningKey = '';
    let warningSequence = 0;

    const ACTION_COPY = Object.freeze({
        syncLeaderboardScore: Object.freeze({
            title: 'Leaderboard update paused',
            task: 'leaderboard updates',
            reassurance: 'Your visited parks are saved. The leaderboard will retry automatically.'
        }),
        getPremiumRoute: Object.freeze({ title: 'Route generation paused', task: 'route generation' }),
        getPremiumRouteBurst: Object.freeze({ title: 'Route generation paused', task: 'route generation' }),
        getPremiumGeocode: Object.freeze({ title: 'Town search paused', task: 'town search' }),
        getPremiumGeocodeBurst: Object.freeze({ title: 'Town search paused', task: 'town search' }),
        createCheckoutSession: Object.freeze({ title: 'Upgrade checkout paused', task: 'upgrade checkout attempts' }),
        restorePremiumPurchase: Object.freeze({ title: 'Purchase restore paused', task: 'purchase restore attempts' }),
        getCustomerPortalUrl: Object.freeze({ title: 'Billing portal paused', task: 'billing portal requests' }),
        cancelPremiumSubscription: Object.freeze({ title: 'Cancellation paused', task: 'subscription cancellation attempts' }),
        deleteAccount: Object.freeze({ title: 'Account deletion paused', task: 'account deletion attempts' }),
        reportClientError: Object.freeze({ title: 'Diagnostic reporting paused', task: 'automatic diagnostic reports' }),
        'ors-directions': Object.freeze({ title: 'Routing provider busy', task: 'route generation' }),
        'ors-geocoding': Object.freeze({ title: 'Town search provider busy', task: 'town search' }),
        'ors-provider': Object.freeze({ title: 'Routing provider busy', task: 'routing requests' })
    });

    function isRateLimitError(error) {
        const code = String(error && error.code || '').toLowerCase();
        return code === 'resource-exhausted' || code === 'functions/resource-exhausted';
    }

    function getRateLimitDetails(error) {
        return error && error.details && typeof error.details === 'object' ? error.details : {};
    }

    function getResetDate(error) {
        const details = getRateLimitDetails(error);
        const retryAtMs = Date.parse(details.retryAt || '');
        if (Number.isFinite(retryAtMs)) return new Date(retryAtMs);
        const retryAfterSeconds = Number(details.retryAfterSeconds);
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
            return new Date(Date.now() + retryAfterSeconds * 1000);
        }
        return null;
    }

    function formatResetTime(resetDate) {
        if (!(resetDate instanceof Date) || !Number.isFinite(resetDate.getTime())) return '';
        const now = new Date();
        const sameDay = resetDate.getFullYear() === now.getFullYear() &&
            resetDate.getMonth() === now.getMonth() &&
            resetDate.getDate() === now.getDate();
        const time = resetDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        if (sameDay) return time;
        const date = resetDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
        return `${date} at ${time}`;
    }

    function formatWaitDuration(error, resetDate) {
        const details = getRateLimitDetails(error);
        let seconds = Number(details.retryAfterSeconds);
        if ((!Number.isFinite(seconds) || seconds <= 0) && resetDate instanceof Date) {
            seconds = Math.ceil((resetDate.getTime() - Date.now()) / 1000);
        }
        if (!Number.isFinite(seconds) || seconds <= 0) return '';
        if (seconds < 60) return 'less than a minute';
        const minutes = Math.ceil(seconds / 60);
        if (minutes < 90) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
        const hours = Math.floor(minutes / 60);
        const remainder = minutes % 60;
        return remainder
            ? `${hours} hour${hours === 1 ? '' : 's'} ${remainder} minutes`
            : `${hours} hour${hours === 1 ? '' : 's'}`;
    }

    function getActionCopy(action) {
        return ACTION_COPY[action] || Object.freeze({ title: 'Please slow down', task: 'this action' });
    }

    function getRateLimitPresentation(error) {
        const details = getRateLimitDetails(error);
        const actionCopy = getActionCopy(details.action);
        const resetDate = getResetDate(error);
        const resetTime = formatResetTime(resetDate);
        const waitDuration = formatWaitDuration(error, resetDate);
        const isGlobal = details.scope === 'global';
        const lead = isGlobal
            ? `The service temporarily paused ${actionCopy.task}.`
            : `Are you a bot? Bot protection paused ${actionCopy.task}.`;
        const retry = waitDuration
            ? `Try again in about ${waitDuration}${resetTime ? `, at ${resetTime}` : ''}.`
            : (resetTime ? `Try again at ${resetTime}.` : 'Try again shortly.');
        const reassurance = actionCopy.reassurance ? ` ${actionCopy.reassurance}` : '';
        return {
            title: isGlobal && actionCopy.title === 'Please slow down'
                ? 'Service temporarily busy'
                : actionCopy.title,
            message: `${lead} ${retry}${reassurance}`,
            details
        };
    }

    function getRateLimitWarning(error) {
        if (!isRateLimitError(error)) return '';
        return getRateLimitPresentation(error).message;
    }

    function ensureWarningPanel() {
        if (!window.document || typeof window.document.createElement !== 'function') return null;
        let panel = window.document.getElementById('rate-limit-warning');
        if (panel) return panel;

        panel = window.document.createElement('section');
        panel.id = 'rate-limit-warning';
        panel.className = 'rate-limit-warning';
        panel.setAttribute('role', 'alert');
        panel.setAttribute('aria-live', 'assertive');
        panel.setAttribute('aria-atomic', 'true');
        panel.hidden = true;

        const icon = window.document.createElement('span');
        icon.className = 'rate-limit-warning__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '⏳';

        const content = window.document.createElement('div');
        content.className = 'rate-limit-warning__content';
        const title = window.document.createElement('strong');
        title.className = 'rate-limit-warning__title';
        title.textContent = 'Please slow down';
        const message = window.document.createElement('span');
        message.className = 'rate-limit-warning__message';
        content.appendChild(title);
        content.appendChild(message);

        const close = window.document.createElement('button');
        close.className = 'rate-limit-warning__close';
        close.type = 'button';
        close.setAttribute('aria-label', 'Dismiss rate limit warning');
        close.textContent = '×';
        close.addEventListener('click', () => {
            panel.classList.remove('show');
            panel.hidden = true;
        });

        panel.appendChild(icon);
        panel.appendChild(content);
        panel.appendChild(close);
        window.document.body.appendChild(panel);
        return panel;
    }

    function renderRateLimitWarning(message, details) {
        const panel = ensureWarningPanel();
        if (!panel) return false;
        const title = panel.querySelector('.rate-limit-warning__title');
        const messageNode = panel.querySelector('.rate-limit-warning__message');
        if (title) title.textContent = details.title || (details.scope === 'global' ? 'Service temporarily busy' : 'Please slow down');
        if (messageNode) messageNode.textContent = message;
        panel.dataset.scope = details.scope === 'global' ? 'global' : 'user';
        panel.hidden = false;
        warningSequence += 1;
        const sequence = warningSequence;
        window.requestAnimationFrame(() => {
            if (sequence === warningSequence) panel.classList.add('show');
        });
        return true;
    }

    function showRateLimitWarning(error) {
        const message = getRateLimitWarning(error);
        if (!message) return false;
        const details = getRateLimitDetails(error);
        const presentation = getRateLimitPresentation(error);
        const key = `${details.action || 'unknown'}|${details.retryAt || message}`;
        const existing = window.document && window.document.getElementById
            ? window.document.getElementById('rate-limit-warning')
            : null;
        if (key === lastWarningKey && existing && !existing.hidden) return true;
        lastWarningKey = key;
        return renderRateLimitWarning(message, { ...details, title: presentation.title });
    }

    window.BARK.rateLimitUi = {
        isRateLimitError,
        getResetDate,
        getRateLimitPresentation,
        getRateLimitWarning,
        showRateLimitWarning,
        ensureWarningPanel
    };
})();
