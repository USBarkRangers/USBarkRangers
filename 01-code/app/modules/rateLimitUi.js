/**
 * rateLimitUi.js — one readable warning for every callable rate limit.
 * Firebase supplies an absolute ISO reset timestamp; the browser renders it in
 * the ranger's own time zone instead of showing server time or raw seconds.
 */
(function () {
    window.BARK = window.BARK || {};
    let lastWarningKey = '';
    let warningSequence = 0;

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

    function getRateLimitWarning(error) {
        if (!isRateLimitError(error)) return '';
        const details = getRateLimitDetails(error);
        const resetTime = formatResetTime(getResetDate(error));
        const lead = details.scope === 'global'
            ? 'This service is unusually busy.'
            : 'Are you a bot?';
        return resetTime
            ? `${lead} Rate limit resets at ${resetTime}.`
            : `${lead} Rate limit resets shortly.`;
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
        if (title) title.textContent = details.scope === 'global' ? 'Service temporarily busy' : 'Please slow down';
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
        const key = `${details.action || 'unknown'}|${details.retryAt || message}`;
        const existing = window.document && window.document.getElementById
            ? window.document.getElementById('rate-limit-warning')
            : null;
        if (key === lastWarningKey && existing && !existing.hidden) return true;
        lastWarningKey = key;
        return renderRateLimitWarning(message, details);
    }

    window.BARK.rateLimitUi = {
        isRateLimitError,
        getResetDate,
        getRateLimitWarning,
        showRateLimitWarning,
        ensureWarningPanel
    };
})();
