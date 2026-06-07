/**
 * panelRenderer.js - Marker click panel rendering.
 * Phase 2 move-only extraction from dataService.js.
 *
 * Future card architecture notes:
 *   This renderer currently assumes a clicked marker is an official BARK park
 *   with canonical data in marker._parkData. Long term, the slide panel should
 *   become a reusable card host that can render multiple card modes without
 *   competing panels:
 *
 *     1. OfficialParkCard
 *        Canonical BARK data: name, state, category, swag links, official info,
 *        official websites, check-in controls, and "add to trip".
 *
 *     2. TripPlaceCard
 *        User itinerary data for non-official places such as towns, hotels,
 *        restaurants, trailheads, or geocoded stops. This card can show name,
 *        coordinates, directions, remove-from-trip, and later per-trip notes.
 *
 *     3. MyVisitCard / MemoryCard
 *        User-owned content: personal notes, dog/BARK photos, visit dates,
 *        private/public visibility, and future review-style fields. This card
 *        should be lazy-loaded after the panel opens. Do not load photos or
 *        rich editors for every marker during map rendering.
 *
 *   Important separation:
 *     Official data should remain read-only from ParkRepo/CSV.
 *     Personal data should live in a user-owned service/collection and be
 *     composed into the panel at render time. Avoid copying personal notes or
 *     photo refs into marker fingerprints, allPoints, or saved route stops; it
 *     would cause unnecessary marker churn and blur official/user ownership.
 *
 *   Suggested future API:
 *     window.BARK.openPlaceCard({
 *       kind: 'official' | 'tripPlace',
 *       placeId,
 *       customPlaceId,
 *       tripStopId,
 *       focus: 'details' | 'memory' | 'photos' | 'notes'
 *     })
 */
window.BARK = window.BARK || {};

function getVaultRepo() {
    return window.BARK.repos && window.BARK.repos.VaultRepo;
}

function getPanelVisitEntry(place) {
    if (typeof window.BARK.getVisitedPlaceEntry === 'function') {
        return window.BARK.getVisitedPlaceEntry(place);
    }

    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.hasVisit === 'function' && typeof vaultRepo.getVisit === 'function') {
        return vaultRepo.hasVisit(place) ? { id: place.id, record: vaultRepo.getVisit(place) } : null;
    }

    return null;
}

function clearElement(element) {
    if (!element) return;
    while (element.firstChild) element.removeChild(element.firstChild);
}

function setTextWithLineBreaks(element, value) {
    if (!element) return;
    clearElement(element);
    String(value || '').split(/\r?\n/).forEach((line, index) => {
        if (index > 0) element.appendChild(document.createElement('br'));
        element.appendChild(document.createTextNode(line));
    });
}

function getSafeHttpUrls(value) {
    if (!value || typeof value !== 'string') return [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = value.match(urlRegex) || [];

    return matches
        .map(rawUrl => rawUrl.replace(/['",]+$/, ''))
        .map(rawUrl => {
            try {
                const url = new URL(rawUrl);
                return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
            } catch (_error) {
                return null;
            }
        })
        .filter(Boolean);
}

function configureExternalLink(link, href) {
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
}

function createExternalLink(href, className, text) {
    const link = document.createElement('a');
    configureExternalLink(link, href);
    link.className = className;
    link.textContent = text;
    return link;
}

function createMetaPill(icon, value, fallback) {
    const pill = document.createElement('div');
    pill.className = 'meta-pill';
    pill.textContent = `${icon} ${value || fallback}`;
    return pill;
}

function openFreeAccountPrompt(source) {
    const accountUi = window.BARK && window.BARK.authAccountUi;
    if (accountUi && typeof accountUi.openAccountPrompt === 'function') {
        accountUi.openAccountPrompt({ source });
        return;
    }

    const profileTab = document.querySelector('.nav-item[data-target="profile-view"]');
    if (profileTab) profileTab.click();
}

function openFreeVisitLimitPaywall(result = {}) {
    const paywall = window.BARK && window.BARK.paywall;
    if (paywall && typeof paywall.openPaywall === 'function') {
        paywall.openPaywall({ source: 'visited-place-limit' });
        return true;
    }

    const limit = result.limit || 5;
    alert(`Free plan limit reached. Free users can mark up to ${limit} parks visited. Adding more than ${limit} parks is a Premium feature.`);
    return false;
}

function setAccountLockedCheckinButton(button, textEl, label, source) {
    if (!button) return;
    button.disabled = false;
    button.classList.remove('visited');
    button.classList.add('account-locked');
    button.setAttribute('aria-disabled', 'true');
    button.title = 'Create a free account to save this to your B.A.R.K. profile.';
    button.style.cursor = 'pointer';
    button.style.opacity = '';
    if (textEl) textEl.textContent = label;
    button.onmouseenter = null;
    button.onmouseleave = null;
    button.onclick = (event) => {
        event.preventDefault();
        openFreeAccountPrompt(source);
    };
}

function clearAccountLockedCheckinButton(button) {
    if (!button) return;
    button.classList.remove('account-locked');
    button.removeAttribute('aria-disabled');
    button.removeAttribute('title');
}

function buildMapSearchUrl(name, lat, lng, provider) {
    const numericLat = Number(lat);
    const numericLng = Number(lng);
    const hasCoords = Number.isFinite(numericLat) && Number.isFinite(numericLng);
    const label = String(name || 'Selected location');

    if (provider === 'apple') {
        const params = new URLSearchParams();
        params.set('q', label);
        if (hasCoords) params.set('ll', `${numericLat},${numericLng}`);
        return `http://maps.apple.com/?${params.toString()}`;
    }

    const query = hasCoords ? `${numericLat},${numericLng}` : label;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

window.BARK.panelRendererSafety = {
    getSafeHttpUrls,
    openFreeVisitLimitPaywall,
    setTextWithLineBreaks
};

function renderMarkerClickPanel(context) {
    const marker = context.marker;
    const slidePanel = context.slidePanel;
    const titleEl = context.titleEl;
    const infoSection = context.infoSection;
    const infoEl = context.infoEl;
    const websitesContainer = context.websitesContainer;
    const picsEl = context.picsEl;
    const videoEl = context.videoEl;
    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    const refreshOnly = context.refreshOnly === true;

    if (!refreshOnly && window.BARK.activePinMarker && window.BARK.activePinMarker._icon) {
        window.BARK.activePinMarker._icon.classList.remove('active-pin');
    }
    if (marker._icon) {
        marker._icon.classList.add('active-pin');
    }
    window.BARK.activePinMarker = marker;

    const panelScrollContainer = document.querySelector('.panel-content');
    if (panelScrollContainer && !refreshOnly) panelScrollContainer.scrollTop = 0;

    if (!refreshOnly) document.getElementById('filter-panel').classList.add('collapsed');

    const d = marker._parkData;
    if (titleEl) titleEl.textContent = d.name || 'Unknown Park';

    const metaContainer = document.getElementById('panel-meta-container');
    if (metaContainer) {
        clearElement(metaContainer);
        metaContainer.appendChild(createMetaPill('📍', d.state, 'N/A'));
        metaContainer.appendChild(createMetaPill('🏷️', d.swagType, 'Other'));
        metaContainer.appendChild(createMetaPill('💰', d.cost, 'Free'));
    }

    const suggestEditBtn = document.getElementById('suggest-edit-btn');
    if (suggestEditBtn) {
        const subject = encodeURIComponent(`B.A.R.K. Map Edit: ${d.name}`);
        const body = encodeURIComponent(`Park Name: ${d.name}\nID: ${d.id}\n\n--- Please describe the update below ---\n`);
        suggestEditBtn.href = `mailto:usbarkrangers@gmail.com?subject=${subject}&body=${body}`;
    }

    // --- UPDATES & REPORTS ---
    if (d.info) {
        if (infoSection) infoSection.style.display = 'block';
        const container = document.getElementById('panel-info-container');
        const showMoreBtn = document.getElementById('show-more-info');
        setTextWithLineBreaks(infoEl, d.info);

        const hasManyLines = String(d.info || '').split(/\r?\n/).length > 5;

        if (d.info.length > 250 || hasManyLines) {
            if (container) container.classList.add('report-collapsed');
            if (showMoreBtn) {
                showMoreBtn.style.display = 'block';
                showMoreBtn.onclick = () => {
                    container.classList.remove('report-collapsed');
                    showMoreBtn.style.display = 'none';
                };
            }
        } else {
            if (container) container.classList.remove('report-collapsed');
            if (showMoreBtn) showMoreBtn.style.display = 'none';
        }
    } else {
        if (infoSection) infoSection.style.display = 'none';
        clearElement(infoEl);
    }

    if (d.pics && typeof d.pics === 'string') {
        const pictureUrls = getSafeHttpUrls(d.pics);
        if (pictureUrls.length > 0) {
            if (picsEl) {
                picsEl.style.display = 'grid';
                clearElement(picsEl);
                pictureUrls.forEach((url, index) => {
                    picsEl.appendChild(createExternalLink(url, 'swag-link-btn', `📷 Swag Pic ${index + 1}`));
                });
            }
        } else {
            if (picsEl) { picsEl.style.display = 'none'; clearElement(picsEl); }
        }
    } else {
        if (picsEl) { picsEl.style.display = 'none'; clearElement(picsEl); }
    }

    const videoUrl = getSafeHttpUrls(d.video || '')[0];
    if (videoUrl) {
        if (videoEl) {
            videoEl.style.display = 'block';
            configureExternalLink(videoEl, videoUrl);
        }
    } else {
        if (videoEl) { videoEl.style.display = 'none'; videoEl.removeAttribute('href'); }
    }

    if (websitesContainer) {
        clearElement(websitesContainer);
        if (d.website && typeof d.website === 'string') {
            const urls = getSafeHttpUrls(d.website);
            if (urls && urls.length > 0) {
                websitesContainer.style.display = 'grid';
                urls.forEach((url, index) => {
                    websitesContainer.appendChild(createExternalLink(
                        url,
                        'website-btn',
                        urls.length > 1 ? `Website ${index + 1}` : 'Official Website'
                    ));
                });
            } else {
                websitesContainer.style.display = 'none';
            }
        } else {
            websitesContainer.style.display = 'none';
        }
    }

    // --- MAP URLS & BUTTON RENDERING ---
    const stickyFooter = document.getElementById('panel-sticky-footer');
    if (stickyFooter) {
        stickyFooter.style.display = 'grid';
        clearElement(stickyFooter);
        stickyFooter.appendChild(createExternalLink(buildMapSearchUrl(d.name, d.lat, d.lng, 'google'), 'dir-btn', '🗺️ Google'));
        stickyFooter.appendChild(createExternalLink(buildMapSearchUrl(d.name, d.lat, d.lng, 'apple'), 'dir-btn', '🧭 Apple'));

        const addTripButton = document.createElement('button');
        addTripButton.className = 'glass-btn btn-trip';
        addTripButton.type = 'button';
        addTripButton.textContent = '➕ Add to Trip';
        stickyFooter.appendChild(addTripButton);

        const btnTrip = stickyFooter.querySelector('.btn-trip');
        if (btnTrip) {
            const tripDays = window.BARK.tripDays;
            const syncPopupUI = () => {
                const inTripDay = Array.from(tripDays).findIndex(day => day.stops.some(s => s.id === d.id));
                if (inTripDay > -1) {
                    btnTrip.textContent = `✓ In Trip (Day ${inTripDay + 1})`;
                    btnTrip.style.background = '#e8f5e9';
                    btnTrip.style.borderColor = '#4CAF50';
                    btnTrip.style.color = '#2E7D32';
                } else {
                    btnTrip.textContent = `➕ Add to Trip`;
                    btnTrip.style.background = '#fff';
                    btnTrip.style.borderColor = '#cbd5e1';
                    btnTrip.style.color = '#333';
                }
            };
            syncPopupUI();
            btnTrip.onclick = (e) => {
                e.preventDefault();
                if (window.addStopToTrip({ id: d.id, name: d.name, lat: d.lat, lng: d.lng, state: d.state || '' })) {
                    syncPopupUI();
                }
            };
        }
    }

    // --- VISITED SECTION ---
    const visitedSection = document.getElementById('panel-visited-section');
    const markVisitedBtn = document.getElementById('mark-visited-btn');
    const markVisitedText = document.getElementById('mark-visited-text');
    const verifyBtn = document.getElementById('verify-checkin-btn');
    const verifyBtnText = document.getElementById('verify-checkin-text');
    const checkinService = window.BARK.services && window.BARK.services.checkin;

    if (visitedSection && markVisitedBtn && markVisitedText && verifyBtn) {
        if (firebaseService && firebaseService.getCurrentUser()) {
            visitedSection.style.display = 'grid';
            clearAccountLockedCheckinButton(markVisitedBtn);
            clearAccountLockedCheckinButton(verifyBtn);

            const visitedEntry = getPanelVisitEntry(d);

            if (visitedEntry) {
                const cachedObj = visitedEntry.record;

                // Match the verify button: if the visit hasn't been confirmed
                // by an authoritative server snapshot yet, render the button
                // in the orange "syncing…" state instead of green. The
                // .visited.pending-sync CSS rule handles the color.
                const vaultRepoForPending = window.BARK.repos && window.BARK.repos.VaultRepo;
                const visitIsPendingSync = vaultRepoForPending
                    && typeof vaultRepoForPending.hasPendingMutation === 'function'
                    && vaultRepoForPending.hasPendingMutation(d.id);

                markVisitedBtn.classList.add('visited');
                markVisitedBtn.classList.toggle('pending-sync', Boolean(visitIsPendingSync));
                markVisitedText.textContent = visitIsPendingSync ? '✓ Visited (syncing…)' : '✓ Visited';

                if (cachedObj.verified) {
                    markVisitedBtn.disabled = true;
                    markVisitedBtn.style.cursor = 'default';
                    markVisitedBtn.style.opacity = '0.7';
                } else {
                    markVisitedBtn.disabled = false;
                    markVisitedBtn.style.cursor = 'pointer';
                    markVisitedBtn.style.opacity = '1';
                }

                if (window.allowUncheck && !cachedObj.verified) {
                    markVisitedBtn.style.background = '#4CAF50';
                    markVisitedBtn.onmouseenter = () => markVisitedText.textContent = '✖ Remove Check-in';
                    markVisitedBtn.onmouseleave = () => markVisitedText.textContent = '✓ Visited';
                } else {
                    markVisitedBtn.onmouseenter = null;
                    markVisitedBtn.onmouseleave = null;
                }

                if (cachedObj.verified) {
                    // Distinguish "server has confirmed this visit" (green) from
                    // "we added it locally but the server hasn't echoed it back
                    // yet" (orange). Without this gate, re-opening the panel
                    // after an offline verify makes the button look fully
                    // confirmed when in reality the visit is still in the
                    // pending-sync queue.
                    const vaultRepo = window.BARK.repos && window.BARK.repos.VaultRepo;
                    const isPendingServerSync = vaultRepo
                        && typeof vaultRepo.hasPendingMutation === 'function'
                        && vaultRepo.hasPendingMutation(d.id);

                    if (isPendingServerSync) {
                        verifyBtn.style.background = '#f59e0b';
                        verifyBtnText.textContent = '🐾 Verified (syncing…)';
                    } else {
                        verifyBtn.style.background = '#4CAF50';
                        verifyBtnText.textContent = '🐾 Verified & Secured';
                    }
                    verifyBtn.disabled = true;
                    verifyBtn.style.cursor = 'default';
                    verifyBtn.style.opacity = '0.7';
                } else {
                    verifyBtn.style.background = '#FF9800';
                    verifyBtnText.textContent = '🐾 Verified Check-In';
                    verifyBtn.disabled = false;
                    verifyBtn.style.cursor = 'pointer';
                    verifyBtn.style.opacity = '1';
                }
            } else {
                markVisitedBtn.classList.remove('visited');
                markVisitedText.textContent = 'Mark as Visited';
                markVisitedBtn.disabled = false;
                markVisitedBtn.style.cursor = 'pointer';
                markVisitedBtn.style.opacity = '1';
                markVisitedBtn.onmouseenter = null;
                markVisitedBtn.onmouseleave = null;

                verifyBtn.style.background = '#FF9800';
                verifyBtnText.textContent = '🐾 Verified Check-In';
                verifyBtn.disabled = false;
                verifyBtn.style.cursor = 'pointer';
                verifyBtn.style.opacity = '1';
            }

            // Verified check-in waits indefinitely for real server confirmation:
            //   orange (#f59e0b) "Verified (syncing...)" — local write queued, retrying server confirmation
            //   green  (#4CAF50) "Verified & Secured"   — Firestore confirmed the visit
            const SERVER_CONFIRMATION_RETRY_MS = 8000;

            const setVerifyButtonStateVerifying = (label) => {
                verifyBtn.style.background = '#facc15';
                verifyBtn.style.color = '#1f2937';
                verifyBtnText.textContent = label;
                verifyBtn.disabled = true;
                verifyBtn.style.cursor = 'progress';
                verifyBtn.style.opacity = '1';
            };
            const setVerifyButtonStateConfirmed = () => {
                verifyBtn.style.background = '#4CAF50';
                verifyBtn.style.color = '';
                verifyBtnText.textContent = '🐾 Verified & Secured';
                verifyBtn.disabled = true;
                verifyBtn.style.cursor = 'default';
                verifyBtn.style.opacity = '0.7';
            };
            const setVerifyButtonStatePendingSync = () => {
                verifyBtn.style.background = '#f59e0b';
                verifyBtn.style.color = '';
                verifyBtnText.textContent = '🐾 Verified (syncing…)';
                verifyBtn.disabled = true;
                verifyBtn.style.cursor = 'progress';
                verifyBtn.style.opacity = '1';
            };
            const restoreVerifyButtonDefault = () => {
                verifyBtn.style.background = '#FF9800';
                verifyBtn.style.color = '';
                verifyBtnText.textContent = '🐾 Verified Check-In';
                verifyBtn.disabled = false;
                verifyBtn.style.cursor = 'pointer';
                verifyBtn.style.opacity = '1';
            };

            verifyBtn.onclick = async () => {
                if (!checkinService || typeof checkinService.verifyGpsCheckin !== 'function') {
                    alert("Check-in service is unavailable. Try again later.");
                    return;
                }
                if (verifyBtn.disabled) return; // debounce double-tap

                setVerifyButtonStateVerifying('Locating…');

                let checkinResult = null;
                try {
                    checkinResult = await checkinService.verifyGpsCheckin(d);
                } catch (error) {
                    console.error("[panelRenderer] verify check-in failed:", error);
                    restoreVerifyButtonDefault();
                    alert("Failed to get location. Try again later.");
                    return;
                }

                if (!checkinResult || !checkinResult.success) {
                    restoreVerifyButtonDefault();
                    const radiusKm = window.BARK.config && window.BARK.config.CHECKIN_RADIUS_KM;
                    const err = checkinResult && checkinResult.error;
                    if (err === 'OUT_OF_RANGE' && Number.isFinite(checkinResult.distance)) {
                        alert(`Out of Range! You are ${checkinResult.distance.toFixed(1)} km away. You must be within ${radiusKm} km to verify.`);
                    } else if (err === 'GEOLOCATION_UNSUPPORTED') {
                        alert("Geolocation is not supported by your browser.");
                    } else if (err === 'PERMISSION_DENIED') {
                        alert("Location permission denied. GPS is required for verified check-ins.");
                    } else if (err === 'LOCATION_FAILED') {
                        alert("Failed to get location. Try again later.");
                    } else if (err === 'FREE_VISIT_LIMIT') {
                        openFreeVisitLimitPaywall(checkinResult);
                    } else {
                        alert("Check-in could not be verified. Try again later.");
                    }
                    return;
                }

                // Local write succeeded. The button and pin stay orange until
                // a real server confirmation proves the visit is durable.
                setVerifyButtonStatePendingSync();
                markVisitedBtn.classList.add('visited');
                markVisitedBtn.classList.add('pending-sync');
                markVisitedText.textContent = '✓ Visited (syncing…)';
                markVisitedBtn.disabled = true;
                markVisitedBtn.style.cursor = 'progress';
                markVisitedBtn.style.opacity = '1';

                const visitId = checkinResult.visitRecord && checkinResult.visitRecord.id;
                const confirmation = typeof checkinService.awaitServerConfirmation === 'function'
                    ? await checkinService.awaitServerConfirmation(visitId, { retryMs: SERVER_CONFIRMATION_RETRY_MS })
                    : { confirmed: true };

                if (confirmation.confirmed) {
                    setVerifyButtonStateConfirmed();
                    alert(`Check-in Verified! You earned 2 points.`);
                    markVisitedBtn.classList.remove('pending-sync');
                    markVisitedText.textContent = '✓ Visited';
                    markVisitedBtn.disabled = true;
                    markVisitedBtn.style.cursor = 'default';
                    markVisitedBtn.style.opacity = '0.7';
                } else if (confirmation.reason === 'write-failed') {
                    restoreVerifyButtonDefault();
                    markVisitedBtn.classList.remove('visited');
                    markVisitedBtn.classList.remove('pending-sync');
                    markVisitedText.textContent = 'Mark as Visited';
                    markVisitedBtn.disabled = false;
                    markVisitedBtn.style.cursor = 'pointer';
                    markVisitedBtn.style.opacity = '1';
                    alert("Check-in could not be saved. Please sign in again and try once more.");
                    return;
                } else {
                    setVerifyButtonStatePendingSync();
                }

                window.syncState();
                window.BARK.updateStatsUI();
            };

            // Three-state mark-visited button to match the verify button:
            //   pending  orange "✓ Visited (syncing…)" — local write done, awaiting server
            //   green    "✓ Visited"                   — authoritative snapshot has the visit
            //   default  "Mark as Visited"             — not visited / removed
            const setMarkVisitedStatePending = () => {
                markVisitedBtn.classList.add('visited');
                markVisitedBtn.classList.add('pending-sync');
                markVisitedText.textContent = '✓ Visited (syncing…)';
                markVisitedBtn.disabled = false;
                markVisitedBtn.style.cursor = 'pointer';
                markVisitedBtn.style.opacity = '1';
                markVisitedBtn.onmouseenter = null;
                markVisitedBtn.onmouseleave = null;
            };
            const setMarkVisitedStateConfirmed = () => {
                markVisitedBtn.classList.add('visited');
                markVisitedBtn.classList.remove('pending-sync');
                markVisitedText.textContent = '✓ Visited';
                markVisitedBtn.disabled = false;
                markVisitedBtn.style.cursor = 'pointer';
                markVisitedBtn.style.opacity = '1';
            };
            const setMarkVisitedStateDefault = () => {
                markVisitedBtn.classList.remove('visited');
                markVisitedBtn.classList.remove('pending-sync');
                markVisitedText.textContent = 'Mark as Visited';
                markVisitedBtn.disabled = false;
                markVisitedBtn.style.cursor = 'pointer';
                markVisitedBtn.style.opacity = '1';
                markVisitedBtn.onmouseenter = null;
                markVisitedBtn.onmouseleave = null;
            };

            markVisitedBtn.onclick = async () => {
                if (!checkinService || typeof checkinService.markAsVisited !== 'function') {
                    alert("Check-in service is unavailable. Try again later.");
                    return;
                }

                let visitResult = null;
                try {
                    visitResult = await checkinService.markAsVisited(d);
                } catch (error) {
                    console.error("[panelRenderer] mark visited failed:", error);
                    alert("Check-in service is unavailable. Try again later.");
                    return;
                }

                if (!visitResult.success) {
                    if (visitResult.error === 'UNCHECK_LOCKED') {
                        alert("🛡️ Data Safety Lock Active\n\nTo prevent you from accidentally losing your 'Date Visited' history, unchecking parks is disabled by default.\n\nYou can turn off this safety feature by opening Settings (⚙️) and enabling 'Allow Uncheck Visited'.");
                    } else if (visitResult.error === 'FREE_VISIT_LIMIT') {
                        openFreeVisitLimitPaywall(visitResult);
                    } else if (visitResult.error !== 'ALREADY_VERIFIED') {
                        alert("Check-in service is unavailable. Try again later.");
                    }
                    return;
                }

                if (visitResult.action === 'removed') {
                    setMarkVisitedStateDefault();
                    window.syncState();
                    return;
                }

                // Local write succeeded — show pending state and wait for the
                // server snapshot to confirm before flipping the button green.
                // Mirrors what verifyGpsCheckin does so the two buttons feel
                // identical: never lie about confirmation, never flip green
                // until Google's servers actually have the visit.
                setMarkVisitedStatePending();
                window.syncState();

                const newVisit = visitResult.visitRecord;
                if (!newVisit || !newVisit.id || typeof checkinService.awaitServerConfirmation !== 'function') {
                    // Can't await confirmation — best-effort flip to confirmed
                    // and let any future snapshot correct us.
                    setMarkVisitedStateConfirmed();
                    return;
                }

                let confirmation;
                try {
                    confirmation = await checkinService.awaitServerConfirmation(newVisit.id, { retryMs: SERVER_CONFIRMATION_RETRY_MS });
                } catch (error) {
                    console.warn('[panelRenderer] mark-as-visited confirmation threw:', error);
                    confirmation = { confirmed: false, reason: 'error' };
                }

                if (confirmation.confirmed) {
                    setMarkVisitedStateConfirmed();
                } else if (confirmation.reason === 'write-failed') {
                    setMarkVisitedStateDefault();
                    alert("Visit could not be saved. Please sign in again and try once more.");
                } else {
                    // Stay orange. The window-online recovery handler in
                    // checkinService will sweep this clean once the device is
                    // back online; the localStorage replay backstops us if the
                    // PWA closes first.
                    setMarkVisitedStatePending();
                }
            };
        } else {
            visitedSection.style.display = 'grid';
            verifyBtn.style.background = '#94a3b8';
            setAccountLockedCheckinButton(markVisitedBtn, markVisitedText, 'Mark as Visited', 'mark-visited');
            setAccountLockedCheckinButton(verifyBtn, verifyBtnText, '🐾 Verified Check-In', 'verified-checkin');
        }
    }

    // --- SMART AUTO-PAN ---
    if (!refreshOnly && !window.stopAutoMovements) {
        const currentZoom = map.getZoom();
        const xOffset = window.innerWidth >= 768 ? -250 : 0;
        const yOffset = window.innerWidth < 768 ? 180 : 0;
        const targetPoint = map.project([d.lat, d.lng], currentZoom).add([xOffset, yOffset]);
        const targetLatLng = map.unproject(targetPoint, currentZoom);

        map.panTo(targetLatLng, {
            animate: !window.instantNav,
            duration: window.instantNav ? 0 : 0.5
        });
    }

    const mapIsActive = typeof window.BARK.isMapVisibleByDefaultViewState === 'function'
        ? window.BARK.isMapVisibleByDefaultViewState()
        : !document.querySelector('.ui-view.active');

    if (slidePanel) {
        if (mapIsActive) slidePanel.classList.add('open');
        else slidePanel.classList.remove('open');
    }
}

window.BARK.renderMarkerClickPanel = renderMarkerClickPanel;
