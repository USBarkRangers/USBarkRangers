/**
 * managePortal.js — the "manage your visited places" list on the Profile screen.
 *
 * WHAT THIS OWNS
 *   One editable row per visited place: the name, a remove button, and a date
 *   picker for correcting when the visit happened.
 *
 * WHAT IT DOES NOT OWN
 *   Persistence. Removing a place and changing a date both delegate to
 *   window.BARK.removeVisitedPlace / updateVisitDate, which own the writes and the
 *   optimistic/rollback behaviour. This file only builds the UI and reports errors.
 *
 * COLLABORATORS (late-bound through window.BARK, so script order cannot break it)
 *   window.BARK.getProfileVisitedPlacesArray — the visit list (profileEngine.js)
 *   window.BARK.removeVisitedPlace           — delete a visit
 *   window.BARK.updateVisitDate              — correct a visit's timestamp
 *
 * ENTRY POINT
 *   window.BARK.renderManagePortal()
 */
window.BARK = window.BARK || {};

(function initManagePortal() {

    function padDatePart(value) {
        return String(value).padStart(2, '0');
    }

    // <input type="date"> wants YYYY-MM-DD in LOCAL time. Using toISOString() here
    // would shift the date by a day for anyone west of UTC.
    function formatVisitDateInputValue(ts) {
        const date = new Date(ts);
        if (Number.isNaN(date.getTime())) return '';

        return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
    }

    function visitedPlaces() {
        return typeof window.BARK.getProfileVisitedPlacesArray === 'function'
            ? window.BARK.getProfileVisitedPlacesArray()
            : [];
    }

    function buildRemoveButton(place) {
        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '&times;';
        removeBtn.className = 'manage-remove-btn';
        removeBtn.setAttribute('aria-label', `Remove ${place.name}`);
        removeBtn.onclick = async () => {
            removeBtn.disabled = true;
            try {
                await window.BARK.removeVisitedPlace(place.id);
            } catch (error) {
                console.error('[managePortal] visit removal failed:', error);
                removeBtn.disabled = false;
                const message = error && error.code === 'local-safety-unavailable'
                    ? 'This device could not create a safe offline copy of that removal. Free some browser storage or leave private browsing, then try again.'
                    : `Could not remove ${place.name}. Please try again.`;
                alert(message);
            }
        };
        return removeBtn;
    }

    // Date picker plus its Update button. The button is disabled while the write is
    // in flight so a double tap can't queue two updates for the same visit.
    function buildDateControls(place) {
        const controls = document.createElement('div');
        controls.className = 'manage-controls';

        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.className = 'manage-date-input';
        dateInput.setAttribute('aria-label', `Visit date for ${place.name}`);
        if (place.ts) dateInput.value = formatVisitDateInputValue(place.ts);

        const updateBtn = document.createElement('button');
        updateBtn.textContent = 'Update';
        updateBtn.className = 'manage-update-btn';
        updateBtn.onclick = async () => {
            if (!dateInput.value) return;

            // Midday local avoids the date landing on the previous day once it is
            // converted to a timestamp in a negative-offset timezone.
            const newTs = new Date(dateInput.value + 'T12:00:00').getTime();

            updateBtn.disabled = true;
            try {
                await window.BARK.updateVisitDate(place.id, newTs);
                alert(`${place.name} date updated!`);
            } catch (error) {
                console.error('[managePortal] visit date update failed:', error);
                alert(`Could not update ${place.name}. Please try again.`);
            } finally {
                updateBtn.disabled = false;
            }
        };

        controls.appendChild(dateInput);
        controls.appendChild(updateBtn);
        return controls;
    }

    function buildPlaceRow(place) {
        const li = document.createElement('li');
        li.className = 'manage-place-row';

        const topRow = document.createElement('div');
        topRow.className = 'manage-place-top';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = place.verified ? `🐾 ${place.name}` : place.name;
        nameSpan.className = 'manage-place-name';

        topRow.appendChild(nameSpan);
        topRow.appendChild(buildRemoveButton(place));

        li.appendChild(topRow);
        li.appendChild(buildDateControls(place));
        return li;
    }

    /** Rebuild the whole list. Cheap enough to re-render wholesale on any change. */
    function renderManagePortal() {
        const listEl = document.getElementById('manage-places-list');
        const countEl = document.getElementById('manage-portal-count');
        if (!listEl || !countEl) return;

        const places = visitedPlaces();
        countEl.textContent = places.length;

        if (places.length === 0) {
            listEl.innerHTML = '<li class="manage-empty">Get exploring!</li>';
            return;
        }

        listEl.innerHTML = '';
        places
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .forEach(place => listEl.appendChild(buildPlaceRow(place)));
    }

    window.BARK.renderManagePortal = renderManagePortal;
    // Exposed for tests: the date formatter has a real timezone trap in it.
    window.BARK.managePortal = { formatVisitDateInputValue };
})();
