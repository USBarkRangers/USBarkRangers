/**
 * feedbackSubjectPicker.js — the "what is this about?" combobox.
 *
 * Two pinned entries sit above a fuzzy search over every B.A.R.K. stop. The
 * scoring, normalisation, and park list are searchEngine's
 * (window.BARK.getLocalParkMatches); this file owns only the listbox, the
 * keyboard behaviour, and what counts as the current selection.
 *
 * Typed text that matches nothing is kept as a free-form subject rather than
 * thrown away — someone reporting a park we have never heard of is exactly the
 * person we least want to argue with.
 */
window.BARK = window.BARK || {};

(function () {
    const SUGGESTION_LIMIT = 8;
    const INPUT_DEBOUNCE_MS = 120;

    const PINNED = Object.freeze([
        Object.freeze({ kind: 'general', id: 'general', label: 'General feedback', hint: 'About the app overall' }),
        Object.freeze({ kind: 'missing', id: 'missing', label: 'Add a missing location', hint: 'A B.A.R.K. stop we do not have yet' })
    ]);

    // Some park names in the sheet carry a street address on its own line. The
    // combobox, the email subject, and the Discord title are all one-liners.
    function oneLine(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function parkOption(park) {
        const name = oneLine(park.name);
        return {
            kind: 'park',
            id: park.id,
            label: park.state ? `${name}, ${park.state}` : name,
            name,
            hint: park.swagType || null
        };
    }

    function matchesQuery(option, query) {
        return option.label.toLowerCase().includes(query.toLowerCase());
    }

    function searchParks(query) {
        if (typeof window.BARK.getLocalParkMatches !== 'function') return [];
        try {
            return window.BARK.getLocalParkMatches(query, SUGGESTION_LIMIT).map(parkOption);
        } catch (error) {
            console.warn('[feedback] park search failed.', error);
            return [];
        }
    }

    function buildOptions(query) {
        const trimmed = String(query || '').trim();
        if (!trimmed) return PINNED.slice();

        const pinned = PINNED.filter(option => matchesQuery(option, trimmed));
        return pinned.concat(searchParks(trimmed)).slice(0, SUGGESTION_LIMIT + PINNED.length);
    }

    /**
     * createFeedbackSubjectPicker({ input, list, onChange })
     *   input  — the text input, already marked role="combobox" in the HTML
     *   list   — the empty <ul role="listbox"> the options are drawn into
     *   onChange(selection) — fires whenever the committed selection changes
     *
     * Returns { select, getSelection, clear, close }.
     */
    function createFeedbackSubjectPicker({ input, list, onChange }) {
        if (!input || !list) return null;

        let options = [];
        let activeIndex = -1;
        let selection = null;
        let debounceTimer = null;
        let blurTimer = null;

        function emit() {
            if (typeof onChange === 'function') onChange(getSelection());
        }

        function optionId(index) {
            return `${list.id || 'feedback-subject-list'}-option-${index}`;
        }

        function close() {
            list.hidden = true;
            list.replaceChildren();
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
            options = [];
            activeIndex = -1;
        }

        function paintActive() {
            Array.from(list.children).forEach((node, index) => {
                const active = index === activeIndex;
                node.classList.toggle('is-active', active);
                node.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            if (activeIndex >= 0) {
                input.setAttribute('aria-activedescendant', optionId(activeIndex));
                const node = list.children[activeIndex];
                if (node && typeof node.scrollIntoView === 'function') {
                    node.scrollIntoView({ block: 'nearest' });
                }
            } else {
                input.removeAttribute('aria-activedescendant');
            }
        }

        function render(nextOptions) {
            options = nextOptions;
            activeIndex = options.length ? 0 : -1;
            list.replaceChildren();

            options.forEach((option, index) => {
                const item = document.createElement('li');
                item.id = optionId(index);
                item.className = `feedback-subject-option feedback-subject-option--${option.kind}`;
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', 'false');

                const label = document.createElement('span');
                label.className = 'feedback-subject-option-label';
                label.textContent = option.label;
                item.appendChild(label);

                if (option.hint) {
                    const hint = document.createElement('span');
                    hint.className = 'feedback-subject-option-hint';
                    hint.textContent = option.hint;
                    item.appendChild(hint);
                }

                // pointerdown, not click: the input's blur would close the list first.
                item.addEventListener('pointerdown', (event) => {
                    event.preventDefault();
                    select(option);
                });

                list.appendChild(item);
            });

            list.hidden = options.length === 0;
            input.setAttribute('aria-expanded', options.length ? 'true' : 'false');
            paintActive();
        }

        function openFor(query) {
            render(buildOptions(query));
        }

        function select(option) {
            selection = option;
            input.value = option ? option.label : '';
            close();
            emit();
        }

        // What the caller gets when nothing in the list was clicked: whatever is
        // in the box, treated as a free-form subject.
        function getSelection() {
            const typed = input.value.trim();
            if (selection && selection.label === typed) return selection;
            if (!typed) return null;
            return { kind: 'freeform', id: null, label: typed };
        }

        function clear() {
            selection = null;
            input.value = '';
            close();
            emit();
        }

        function moveActive(delta) {
            if (!options.length) {
                openFor(input.value);
                return;
            }
            activeIndex = (activeIndex + delta + options.length) % options.length;
            paintActive();
        }

        input.addEventListener('input', () => {
            selection = null;
            window.clearTimeout(debounceTimer);
            debounceTimer = window.setTimeout(() => openFor(input.value), INPUT_DEBOUNCE_MS);
            emit();
        });

        input.addEventListener('focus', () => {
            window.clearTimeout(blurTimer);
            openFor(input.value);
        });

        input.addEventListener('blur', () => {
            // Delayed so a pointerdown on an option still lands.
            blurTimer = window.setTimeout(close, 120);
        });

        input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveActive(1);
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveActive(-1);
                return;
            }
            if (event.key === 'Enter' && !list.hidden && activeIndex >= 0) {
                // Only swallow Enter when a suggestion is genuinely highlighted,
                // so the form can still be submitted from this field otherwise.
                event.preventDefault();
                select(options[activeIndex]);
                return;
            }
            if (event.key === 'Escape' && !list.hidden) {
                event.preventDefault();
                event.stopPropagation();   // the overlay's Escape handler would close the modal
                close();
            }
        });

        return { select, getSelection, clear, close, PINNED };
    }

    window.BARK.createFeedbackSubjectPicker = createFeedbackSubjectPicker;
    window.BARK.FEEDBACK_SUBJECT_PINNED = PINNED;
})();
