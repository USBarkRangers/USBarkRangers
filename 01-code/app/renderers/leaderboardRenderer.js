/**
 * leaderboardRenderer.js - Pure leaderboard rank formatting and row DOM helpers.
 */
window.BARK = window.BARK || {};

(function initLeaderboardRenderer() {
    function getSafeLeaderboardRank(rank) {
        const parsed = Number(rank);
        if (!Number.isFinite(parsed) || parsed < 1) return null;
        return Math.trunc(parsed);
    }

    function formatLeaderboardRank(rank) {
        const safeRank = getSafeLeaderboardRank(rank);
        if (!safeRank) return '--';
        return safeRank > 1000 ? safeRank.toLocaleString() : String(safeRank);
    }

    function getLeaderboardScore(user) {
        return user.totalPoints !== undefined ? user.totalPoints : (user.totalVisited || 0);
    }

    function createLeaderboardRow({ user, rank, currentUid, isPinnedSelf = false, previousUser = null }) {
        const isMe = user.uid === currentUid;
        const li = document.createElement('li');
        const safeRank = getSafeLeaderboardRank(rank);
        const displayRank = formatLeaderboardRank(safeRank);

        let bg = 'white', border = '1px solid rgba(0,0,0,0.05)', shadow = '0 2px 4px rgba(0,0,0,0.05)', textColor = '#444', rankIcon = `#${displayRank}`;

        if (isPinnedSelf) { bg = 'rgba(59, 130, 246, 0.08)'; border = '2px dashed #3b82f6'; shadow = '0 4px 10px rgba(59, 130, 246, 0.2)'; textColor = '#1e3a8a'; li.style.marginTop = '15px'; }
        else if (safeRank === 1) { bg = 'linear-gradient(135deg, #fde68a, #f59e0b, #d97706)'; border = '2px solid #b45309'; shadow = '0 4px 12px rgba(217, 119, 6, 0.3)'; textColor = '#451a03'; rankIcon = '👑'; }
        else if (safeRank === 2) { bg = 'linear-gradient(135deg, #f1f5f9, #94a3b8, #475569)'; border = '2px solid #334155'; shadow = '0 4px 10px rgba(71, 85, 105, 0.2)'; textColor = '#0f172a'; }
        else if (safeRank === 3) { bg = 'linear-gradient(135deg, #ffedd5, #d97706, #92400e)'; border = '2px solid #78350f'; shadow = '0 4px 10px rgba(146, 64, 14, 0.2)'; textColor = '#431407'; }
        else if (isMe) { bg = 'rgba(59, 130, 246, 0.08)'; border = '2px solid #3b82f6'; textColor = '#1e3a8a'; }

        li.style.cssText = `display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; margin-bottom: 10px; border-radius: 14px; background: ${bg}; border: ${border}; box-shadow: ${shadow}; transition: all 0.3s ease;`;

        const leftSide = document.createElement('div');
        leftSide.style.cssText = 'display: flex; align-items: center; gap: 12px;';
        const rankBadge = document.createElement('span');
        rankBadge.textContent = rankIcon;
        rankBadge.style.cssText = `font-weight: 900; font-size: 14px; color: ${textColor}; min-width: 24px;`;
        const nameInfo = document.createElement('div');
        nameInfo.style.cssText = 'display: flex; flex-direction: column;';
        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = `font-weight: 800; font-size: 13px; color: ${textColor};`;
        nameSpan.textContent = `${isPinnedSelf ? 'You' : user.displayName} ${user.hasVerified ? '🐾' : ''}`;
        nameInfo.appendChild(nameSpan);

        if (isMe && safeRank === 1) {
            const alphaBadge = document.createElement('span');
            alphaBadge.textContent = '🐺 ALPHA DOG';
            alphaBadge.style.cssText = 'font-size: 9px; font-weight: 900; color: #fff; background: rgba(0,0,0,0.4); padding: 2px 6px; border-radius: 4px; margin-top: 2px; width: fit-content; letter-spacing: 0.5px;';
            nameInfo.appendChild(alphaBadge);
        }

        leftSide.appendChild(rankBadge);
        leftSide.appendChild(nameInfo);

        const rightSide = document.createElement('div');
        rightSide.style.cssText = 'display: flex; flex-direction: column; align-items: flex-end; gap: 4px;';
        const scorePill = document.createElement('span');
        scorePill.style.cssText = `background: ${safeRank && safeRank <= 3 ? 'rgba(255,255,255,0.3)' : 'rgba(76, 175, 80, 0.1)'}; color: ${safeRank && safeRank <= 3 ? textColor : '#2E7D32'}; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 800;`;
        const displayScore = getLeaderboardScore(user);
        scorePill.textContent = `${displayScore} PTS`;
        rightSide.appendChild(scorePill);

        if (isMe && safeRank > 1 && previousUser) {
            const competitorScore = getLeaderboardScore(previousUser);
            const myScore = getLeaderboardScore(user);
            const pointsToOvertake = parseFloat((competitorScore - myScore + 0.1).toFixed(1));
            if (pointsToOvertake > 0) {
                const rivalryPill = document.createElement('span');
                rivalryPill.className = 'rivalry-pill';
                rivalryPill.style.cssText = 'background: #fee2e2; color: #dc2626; padding: 3px 8px; border-radius: 12px; font-size: 9px; font-weight: 900; letter-spacing: 0.5px;';
                rivalryPill.textContent = `🚨 ${pointsToOvertake} PTS TO OVERTAKE`;
                rightSide.appendChild(rivalryPill);
            }
        }

        li.appendChild(leftSide);
        li.appendChild(rightSide);
        return li;
    }

    window.BARK.leaderboardRenderer = {
        getSafeLeaderboardRank,
        formatLeaderboardRank,
        createLeaderboardRow
    };
})();
