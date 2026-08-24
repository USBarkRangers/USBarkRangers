/**
 * rateLimitUi.js — one readable warning for every callable rate limit.
 * Firebase supplies an absolute ISO reset timestamp; the browser renders it in
 * the ranger's own time zone instead of showing server time or raw seconds.
 */
(function () {
    window.BARK = window.BARK || {};
    let lastWarningKey = '';

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
        const resetTime = formatResetTime(getResetDate(error));
        return resetTime
            ? `Are you a bot? Rate limit resets at ${resetTime}.`
            : 'Are you a bot? Rate limit resets shortly.';
    }

    function showRateLimitWarning(error) {
        const message = getRateLimitWarning(error);
        if (!message) return false;
        const details = getRateLimitDetails(error);
        const key = `${details.action || 'unknown'}|${details.retryAt || message}`;
        if (key === lastWarningKey) return true;
        lastWarningKey = key;
        if (typeof window.alert === 'function') window.alert(message);
        return true;
    }

    window.BARK.rateLimitUi = {
        isRateLimitError,
        getResetDate,
        getRateLimitWarning,
        showRateLimitWarning
    };
})();
