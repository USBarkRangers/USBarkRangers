/**
 * launchFlags.js - Stage 0 launch safety switches.
 *
 * Keep defaults conservative and easy to change during beta. These are app-side
 * guardrails only; expensive/sensitive callables also enforce server flags.
 */
window.BARK_LAUNCH_FLAGS = {
    checkoutEnabled: true,
    routePlannerEnabled: true,
    routeGenerationEnabled: true,
    premiumGeocodeEnabled: true,
    leaderboardDeepBrowsingEnabled: true,
    feedbackEnabled: true,
    premiumRiskyToolsEnabled: true,
    ...(window.BARK_LAUNCH_FLAGS || {})
};
