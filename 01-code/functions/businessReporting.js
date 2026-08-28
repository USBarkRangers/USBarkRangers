"use strict";

// ===== PLAIN-LANGUAGE BUSINESS REPORTS =====
// Collection stays in opsMetrics. This module reads the already-cached cost
// snapshot and turns the combined result into a short decision-focused report.

const COST_SNAPSHOT_PATH = "system/costStatus";

function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function count(value) {
    const number = finite(value);
    return number === null ? "n/a" : Math.max(0, Math.round(number)).toLocaleString("en-US");
}

function money(value) {
    const number = finite(value);
    return number === null ? "n/a" : `$${number.toFixed(number >= 10 ? 0 : 2)}`;
}

function percent(numerator, denominator) {
    const top = finite(numerator);
    const bottom = finite(denominator);
    if (top === null || bottom === null || bottom <= 0) return null;
    return top / bottom * 100;
}

function percentText(value) {
    return value === null ? "n/a" : `${value.toFixed(1)}%`;
}

function getUsageTrend(current, previous, periodWord) {
    const currentValue = finite(current);
    const previousValue = finite(previous);
    if (currentValue === null) return { direction: "unknown", text: "Usage comparison is unavailable." };
    if (previousValue === null) {
        return { direction: "new", text: `No complete earlier ${periodWord} is available for comparison yet.` };
    }
    if (previousValue === 0) {
        return currentValue === 0
            ? { direction: "steady", text: `Steady at 0 people versus the previous ${periodWord}.` }
            : { direction: "growing", text: `Growing from 0 to ${count(currentValue)} people versus the previous ${periodWord}.` };
    }

    const change = (currentValue - previousValue) / previousValue * 100;
    const rounded = Math.abs(change).toFixed(1);
    if (Math.abs(change) < 1) {
        return { direction: "steady", text: `Steady at ${count(currentValue)} people versus ${count(previousValue)} in the previous ${periodWord}.` };
    }
    if (change > 0) {
        return { direction: "growing", text: `Growing ${rounded}%: ${count(currentValue)} people versus ${count(previousValue)} in the previous ${periodWord}.` };
    }
    return { direction: "shrinking", text: `Down ${rounded}%: ${count(currentValue)} people versus ${count(previousValue)} in the previous ${periodWord}.` };
}

async function loadCostSnapshot(db, options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, "costSnapshot")) return options.costSnapshot;
    if (!db || typeof db.doc !== "function") return null;
    try {
        const snapshot = await db.doc(COST_SNAPSHOT_PATH).get();
        return snapshot && snapshot.exists && typeof snapshot.data === "function" ? snapshot.data() : null;
    } catch (error) {
        console.error("[reports] Cached cost snapshot unavailable.", { message: error && error.message });
        return null;
    }
}

function premiumSummary(summary) {
    const users = summary.costSnapshot && summary.costSnapshot.users;
    const registered = finite(users && users.registered);
    const premium = finite(users && users.premium);
    const adoption = percent(premium, registered);
    const funnel = summary.traffic && summary.traffic.paymentFunnel;
    const paywall = finite(funnel && funnel["paywall-open"]);
    const confirmed = finite(funnel && funnel["premium-confirmed"]);
    const checkoutRate = percent(confirmed, paywall);

    const accountText = registered === null || premium === null
        ? "Premium account totals unavailable"
        : `${count(premium)} of ${count(registered)} accounts have Premium (${percentText(adoption)})`;
    const checkoutText = paywall === null || confirmed === null
        ? "tracked checkout completion unavailable"
        : (paywall === 0
            ? "no tracked paywall opens"
            : `${count(confirmed)} of ${count(paywall)} tracked paywall opens confirmed Premium (${percentText(checkoutRate)})`);
    return `${accountText} · ${checkoutText}`;
}

function costSummary(summary) {
    const snapshot = summary.costSnapshot;
    if (!snapshot || !snapshot.costs) return "Cost overview unavailable";
    const costs = snapshot.costs;
    const actual = finite(costs.cloudActualMtd);
    const actualText = actual === null ? "cloud bill still processing" : `${money(actual)} cloud cost recorded this month`;
    return `${money(costs.allInMonthlyRunRate)}/month at the current all-in pace · ${actualText} · ${money(costs.costPerActiveUser)} per active user`;
}

function issueSummary(summary) {
    const funnel = summary.traffic && summary.traffic.paymentFunnel || {};
    const checkoutWarnings = (finite(funnel["checkout-start-failed"]) || 0) +
        (finite(funnel["premium-confirmation-timeout"]) || 0);
    return `${count(summary.clientErrors)} app error reports · ${count(checkoutWarnings)} checkout warning signals · ${count(summary.feedback)} customer submissions`;
}

function liveActivitySummary(summary) {
    const traffic = summary.traffic;
    if (!traffic) return "Live load counter unavailable; Google visitor totals above are still reported independently";
    return `${count(traffic.appOpens)} app loads · ${count(traffic.appVisits)} visits · ${count(traffic.repeatOpens)} additional reloads`;
}

function reportDescription(trend, summary) {
    const errors = finite(summary.clientErrors) || 0;
    const funnel = summary.traffic && summary.traffic.paymentFunnel || {};
    const paymentWarnings = (finite(funnel["checkout-start-failed"]) || 0) +
        (finite(funnel["premium-confirmation-timeout"]) || 0);
    const attention = [];
    if (errors > 0) attention.push(`${count(errors)} app error report${errors === 1 ? "" : "s"}`);
    if (paymentWarnings > 0) attention.push(`${count(paymentWarnings)} checkout warning${paymentWarnings === 1 ? "" : "s"}`);
    const direction = trend.direction === "growing" ? "The app grew"
        : trend.direction === "shrinking" ? "Usage declined"
            : trend.direction === "steady" ? "Usage held steady"
                : "Usage was recorded";
    return attention.length
        ? `${direction}. Review ${attention.join(" and ")}.`
        : `${direction}, with no tracked app or checkout warnings needing attention.`;
}

function buildBusinessReport(summary, options = {}) {
    const kind = options.kind === "weekly" ? "weekly" : "daily";
    const isLive = kind === "daily" && options.reportMode === "live";
    const periodWord = kind === "weekly" ? "week" : "day";
    const ga = summary.ga4 && summary.ga4.period;
    const previous = summary.ga4 && summary.ga4.previousPeriod;
    const trend = isLive
        ? { direction: "live", text: "Today is still in progress; growth is finalized in tomorrow morning's report." }
        : getUsageTrend(ga && ga.totalUsers, previous && previous.totalUsers, periodWord);
    const fields = [
        {
            name: "People using the app",
            value: ga
                ? `${count(ga.totalUsers)} people · ${count(ga.newUsers)} new · ${count(ga.returningUsers)} returning · ${count(ga.sessions)} visits`
                : "Usage data unavailable"
        },
        { name: "App activity", value: liveActivitySummary(summary), inline: false },
        { name: "Growing or shrinking?", value: trend.text },
        { name: "Premium", value: premiumSummary(summary), inline: false },
        { name: "Cost overview", value: costSummary(summary), inline: false },
        { name: "Needs attention", value: issueSummary(summary), inline: false }
    ];

    if (kind === "weekly" && ga) {
        fields.splice(2, 0, {
            name: "Engagement",
            value: `${percentText(percent(ga.returningUsers, ga.totalUsers))} returning-user share · ${count(ga.screenViews)} app screens viewed`
        });
    }

    return {
        channel: kind === "weekly" ? "weeklyReport" : (isLive ? "dailyMetrics" : "dailyBriefing"),
        tier: "routine",
        title: `${kind === "weekly" ? "Weekly business report" : (isLive ? "Today so far" : "Morning briefing — yesterday finalized")} — ${summary.periodLabel || "latest period"}`,
        description: reportDescription(trend, summary),
        fields,
        footer: kind === "weekly"
            ? "One report each Monday · completed period only · costs use the latest saved cost check"
            : (isLive
                ? "Mid-afternoon live snapshot · Google may finish processing today's data later · costs use the latest saved cost check"
                : "Morning finalized snapshot for the previous day · costs use the latest saved cost check")
    };
}

module.exports = {
    COST_SNAPSHOT_PATH,
    finite,
    count,
    money,
    percent,
    percentText,
    getUsageTrend,
    loadCostSnapshot,
    premiumSummary,
    costSummary,
    issueSummary,
    liveActivitySummary,
    reportDescription,
    buildBusinessReport
};
