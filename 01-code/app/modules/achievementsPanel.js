/**
 * achievementsPanel.js — draws the Achievement Vault.
 *
 * WHAT THIS OWNS
 *   Turning an evaluated achievements object into the three-tab vault UI:
 *   RARE FEATS | PAWS | STATES, the badge cards, the flip interaction, and the
 *   states ordering.
 *
 * WHAT IT DOES NOT OWN
 *   Deciding which badges are earned — that is gamificationLogic.js ("the brain").
 *   This file never touches Firestore and never computes a score. Hand it an
 *   already-evaluated object and it draws it.
 *
 * THE DATA CONTRACT
 *   Every badge carries `category: 'paws' | 'rareFeats' | 'states'`, set by
 *   gamificationLogic. Filtering and labelling key off that field, never off
 *   substrings of the id.
 *
 *   Extra flags this file honours:
 *     classified: true   — a Rare Feat that stays hidden until earned. Locked ones
 *                          render as a lock + "CLASSIFIED" + a <=3 word `teaser`,
 *                          so the badge's real name never reaches the DOM.
 *     percentComplete    — states only; drives the progress bar on locked cards.
 *     stateCode          — states only; used for the distance sort.
 *
 * ENTRY POINT
 *   window.BARK.achievementsPanel.render(achievements, { userLocationMarker, allPoints })
 */
window.BARK = window.BARK || {};

(function initAchievementsPanel() {

    // ---------------------------------------------------------------------
    // Escaping helpers
    // ---------------------------------------------------------------------

    // For values interpolated into a single-quoted inline onclick argument.
    const escArg = (str) => String(str || '').replace(/'/g, "\\'");

    // For values interpolated into a double-quoted HTML attribute.
    const escAttr = (str) => String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // ---------------------------------------------------------------------
    // Card pieces
    // ---------------------------------------------------------------------

    // Sub-line used on the share image. Falls back to a per-category default when a
    // badge has no description of its own.
    function getSubtitle(badge) {
        const explicit = badge.desc || badge.hint || '';
        if (explicit) return explicit;
        if (badge.category === 'paws') return 'Verified Check-ins';
        if (badge.category === 'states') return '100% cleared!!';
        return '';
    }

    // Only unlocked cards are interactive; locked ones must not be focusable or
    // announce a name, which also keeps classified names out of the a11y tree.
    function getFlipSceneAttrs(badge) {
        if (badge.status !== 'unlocked') return 'class="flip-scene"';
        return `class="flip-scene is-unlocked" role="button" tabindex="0" aria-pressed="false" aria-label="Flip ${escAttr(badge.name)} badge"`;
    }

    function getTierClass(badge) {
        if (badge.status !== 'unlocked') return 'locked-tier';
        return badge.tier === 'verified' ? 'verified-tier' : 'honor-tier';
    }

    function renderShareButton(badge) {
        if (badge.status !== 'unlocked') return '';
        const subtitle = getSubtitle(badge);
        return `<button class="badge-share-btn" onclick="shareSingleBadge('${escArg(badge.name)}', '${escArg(badge.icon)}', '${escArg(badge.tier)}', ${badge.classified ? 'true' : 'false'}, '${escArg(subtitle)}')">📸 SHARE</button>`;
    }

    // Progress bar for a locked state badge. Other categories have no partial state.
    function renderProgress(badge) {
        if (badge.status === 'unlocked' || typeof badge.percentComplete === 'undefined') return '';
        return `
            <div class="state-progress-wrap">
                <div class="state-progress-track">
                    <div class="state-progress-fill" style="width: ${badge.percentComplete}%;"></div>
                </div>
                <span class="state-progress-text">${badge.percentComplete}%</span>
            </div>`;
    }

    /**
     * The single badge card renderer, used by all three tabs.
     * Front face shows identity; back face shows the earned date and share button.
     */
    function renderBadgeCard(badge) {
        const isUnlocked = badge.status === 'unlocked';

        // A classified feat that has not been earned must reveal nothing: no real
        // name, no icon, no criteria. Only the short teaser hints at it.
        const isHiddenClassified = Boolean(badge.classified) && !isUnlocked;

        const icon = isHiddenClassified ? '🔒' : badge.icon;
        const name = isHiddenClassified ? 'CLASSIFIED' : badge.name;
        const detail = isHiddenClassified ? (badge.teaser || '') : (badge.criteria || '');

        const classifiedTag = (badge.classified && isUnlocked)
            ? '<div class="classified-tag">★ CLASSIFIED</div>'
            : '';
        const upgradeCta = (isUnlocked && badge.tier === 'honor')
            ? '<div class="upgrade-pill">⭐ VERIFY TO UPGRADE</div>'
            : '';

        return `
        <div ${getFlipSceneAttrs(badge)}>
            <div class="skeuo-badge ${getTierClass(badge)} ${isUnlocked ? 'unlocked hover-float' : 'locked'}${badge.classified ? ' classified-feat' : ''}">
                <div class="badge-face badge-front">
                    ${classifiedTag}
                    <div class="badge-icon">${icon}</div>
                    <div class="badge-details">
                        <h4>${name}</h4>
                        ${detail ? `<div class="badge-crit">${detail}</div>` : ''}
                    </div>
                    ${renderProgress(badge)}
                </div>
                <div class="badge-face badge-back">
                    <div class="engraved-date">EST. ${badge.dateEarned || '--/--/----'}</div>
                    ${upgradeCta}
                    ${renderShareButton(badge)}
                </div>
            </div>
        </div>`;
    }

    // ---------------------------------------------------------------------
    // States ordering
    // ---------------------------------------------------------------------

    // Nearest-state-first needs a distance per state, derived from the closest park
    // in each state to the user (or the map centre when location is unavailable).
    function buildStateDistances(allPoints, userLocationMarker) {
        const distances = {};
        const reference = userLocationMarker
            ? userLocationMarker.getLatLng()
            : (typeof map !== 'undefined' && map ? map.getCenter() : null);

        if (!reference || !Array.isArray(allPoints)) return distances;

        allPoints.forEach(point => {
            if (!point.state || !point.lat || !point.lng) return;
            const distance = window.BARK.haversineDistance(
                reference.lat, reference.lng, parseFloat(point.lat), parseFloat(point.lng)
            );
            String(point.state).split(/[,/]/).forEach(fragment => {
                const code = window.gamificationEngine.getNormalizedStateCode(fragment);
                if (!code) return;
                if (distances[code] === undefined || distance < distances[code]) {
                    distances[code] = distance;
                }
            });
        });

        return distances;
    }

    function findNearestStateCode(distances) {
        let nearest = null;
        let shortest = Infinity;
        for (const [code, distance] of Object.entries(distances)) {
            if (distance < shortest) { shortest = distance; nearest = code; }
        }
        return nearest;
    }

    // States are ordered for usefulness, not alphabetically:
    //   1. the state the user is standing in
    //   2. completed states, newest first
    //   3. everything else, nearest first
    function sortStateBadges(stateBadges, distances, nearestStateCode) {
        const codeOf = badge => badge.stateCode || badge.id.replace('state-', '').toUpperCase();

        return stateBadges.sort((a, b) => {
            const aCode = codeOf(a);
            const bCode = codeOf(b);

            const aIsCurrent = aCode === nearestStateCode;
            const bIsCurrent = bCode === nearestStateCode;
            if (aIsCurrent !== bIsCurrent) return aIsCurrent ? -1 : 1;

            const aUnlocked = a.status === 'unlocked';
            const bUnlocked = b.status === 'unlocked';
            if (aUnlocked !== bUnlocked) return aUnlocked ? -1 : 1;
            if (aUnlocked && bUnlocked) return (b.dateEarnedTs || 0) - (a.dateEarnedTs || 0);

            const aDistance = distances[aCode] !== undefined ? distances[aCode] : Infinity;
            const bDistance = distances[bCode] !== undefined ? distances[bCode] : Infinity;
            return aDistance - bDistance;
        });
    }

    // Leading card on the States tab: overall national completion.
    function renderNationalCard(nationalProgress) {
        return `
        <div class="flip-scene">
            <div class="skeuo-badge national-card">
                <div class="national-card-flag">🇺🇸</div>
                <h4 class="national-card-title">National Map</h4>
                <div class="national-card-track">
                    <div class="national-card-fill" style="width: ${nationalProgress.percentComplete}%;"></div>
                </div>
                <span class="national-card-count">${nationalProgress.totalVisited} / ${nationalProgress.totalParks} SITES</span>
            </div>
        </div>`;
    }

    // ---------------------------------------------------------------------
    // Interaction
    // ---------------------------------------------------------------------

    // Cards are re-created on every render, so their handlers are re-bound here.
    function bindCardFlips() {
        document.querySelectorAll('.flip-scene.is-unlocked').forEach(scene => {
            const toggleFlip = () => {
                const isFlipped = scene.classList.toggle('is-flipped');
                scene.setAttribute('aria-pressed', isFlipped ? 'true' : 'false');
            };

            scene.onclick = (event) => {
                // Let the share button inside the card handle its own click.
                if (event.target.closest('button, a, input, select, textarea')) return;
                toggleFlip();
            };

            scene.onkeydown = (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggleFlip();
            };
        });
    }

    function bindTabs() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                const content = document.getElementById(btn.dataset.tab + '-content');
                if (content) content.classList.add('active');
            };
        });
    }

    // ---------------------------------------------------------------------
    // Entry point
    // ---------------------------------------------------------------------

    /**
     * Draw the whole vault.
     * @param achievements evaluated object from gamificationEngine
     * @param context      { userLocationMarker, allPoints } for the states distance sort
     */
    function render(achievements, context = {}) {
        if (!achievements) return;

        // Rare Feats already arrives ordered normal-then-classified (see
        // gamificationEngine.sortRareFeats); Paws uses the same card renderer.
        window.BARK.safeUpdateHTML('rare-feats-grid', achievements.rareFeats.map(renderBadgeCard).join(''));
        window.BARK.safeUpdateHTML('paws-grid', achievements.paws.map(renderBadgeCard).join(''));

        const distances = buildStateDistances(context.allPoints, context.userLocationMarker);
        const sortedStates = sortStateBadges(
            achievements.stateBadges,
            distances,
            findNearestStateCode(distances)
        );

        window.BARK.safeUpdateHTML(
            'states-grid',
            renderNationalCard(achievements.nationalProgress) + sortedStates.map(renderBadgeCard).join('')
        );

        bindCardFlips();
        bindTabs();
    }

    window.BARK.achievementsPanel = {
        render,
        // Exposed for tests: the pure pieces, so card and ordering rules can be
        // asserted without a DOM.
        renderBadgeCard,
        getSubtitle,
        sortStateBadges
    };
})();
