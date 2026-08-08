/**
 * feedbackModal.js — the Feedback dialog: open/close, form state, submit.
 *
 * Deliberately owns no logic that can be tested without a browser. Its three
 * collaborators do the real work:
 *   modules/feedbackTransport.js      — the callable and the mailto
 *   modules/feedbackSubjectPicker.js  — the "what is this about?" combobox
 *   utils/imageDownscale.js           — shrinking a picked photo
 *
 * One press of Submit files the report with the team AND opens a prefilled email
 * the reporter can edit. If the backend call fails, the email still opens: a
 * server hiccup must never eat someone's feedback.
 */
window.BARK = window.BARK || {};

(function () {
    const MAX_SCREENSHOTS = 3;   // matches MAX_FILES in functions/feedbackAttachments.js

    const state = {
        phase: 'form',        // 'form' | 'sending' | 'success'
        source: 'manual',
        typeId: null,
        screenshots: [],
        lastFocused: null,
        emailUrl: null
    };

    let picker = null;
    let initialized = false;

    const byId = (id) => document.getElementById(id);
    const transport = () => window.BARK.feedbackTransport;

    // Same check authService makes. Duplicated rather than imported: it is two
    // lines of platform sniffing, and coupling the dialog to the auth module for
    // it would be the worse trade.
    function isStandaloneDisplayMode() {
        if (window.navigator && window.navigator.standalone === true) return true;
        return typeof window.matchMedia === 'function'
            && window.matchMedia('(display-mode: standalone)').matches;
    }

    function isSubjectListOpen() {
        const list = byId('feedback-subject-list');
        return Boolean(list && !list.hidden);
    }

    function feedbackDisabledMessage() {
        if (typeof window.BARK.isLaunchFlagEnabled !== 'function') return null;
        if (window.BARK.isLaunchFlagEnabled('feedbackEnabled')) return null;
        return window.BARK.getLaunchFlagMessage('feedbackEnabled');
    }

    // ====== FORM READ/WRITE ======

    function setType(typeId) {
        state.typeId = typeId;
        const group = byId('feedback-type-group');
        if (!group) return;
        group.querySelectorAll('[data-feedback-type]').forEach((button) => {
            const selected = button.dataset.feedbackType === typeId;
            button.classList.toggle('is-selected', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
    }

    function updateMessageCount() {
        const message = byId('feedback-message');
        const counter = byId('feedback-message-count');
        if (!message || !counter) return;
        const max = transport().MAX_MESSAGE_LENGTH;
        counter.textContent = `${message.value.length} / ${max}`;
        counter.classList.toggle('is-full', message.value.length >= max);
    }

    function readForm() {
        const subject = picker ? picker.getSelection() : null;
        const message = byId('feedback-message');
        const name = byId('feedback-name');
        const email = byId('feedback-email');

        return {
            typeId: state.typeId,
            subjectLabel: subject ? subject.label : 'General feedback',
            subjectKind: subject ? subject.kind : 'general',
            parkId: subject && subject.kind === 'park' ? subject.id : null,
            message: message ? message.value : '',
            name: name ? name.value.trim() : '',
            email: email ? email.value.trim() : '',
            screenshots: state.screenshots.map(shot => ({
                name: shot.name,
                mimeType: shot.mimeType,
                dataBase64: shot.dataBase64
            })),
            screenshotCount: state.screenshots.length
        };
    }

    function showStatus(text, tone = 'error') {
        const status = byId('feedback-status');
        if (!status) return;
        status.textContent = text || '';
        status.hidden = !text;
        status.dataset.tone = tone;
    }

    // ====== SCREENSHOTS ======

    function renderScreenshots() {
        const list = byId('feedback-shots-list');
        const addButton = byId('feedback-shots-add');
        if (!list) return;

        list.replaceChildren();
        state.screenshots.forEach((shot) => {
            const item = document.createElement('li');
            item.className = 'feedback-shot';

            const image = document.createElement('img');
            image.className = 'feedback-shot-image';
            image.alt = shot.name;
            image.src = `data:${shot.mimeType};base64,${shot.dataBase64}`;
            item.appendChild(image);

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'feedback-shot-remove';
            remove.setAttribute('aria-label', `Remove ${shot.name}`);
            remove.textContent = '×';
            remove.addEventListener('click', () => {
                state.screenshots = state.screenshots.filter(candidate => candidate.id !== shot.id);
                renderScreenshots();
            });
            item.appendChild(remove);

            list.appendChild(item);
        });

        if (addButton) {
            const full = state.screenshots.length >= MAX_SCREENSHOTS;
            addButton.disabled = full;
            addButton.textContent = full
                ? `${MAX_SCREENSHOTS} of ${MAX_SCREENSHOTS} added`
                : `Add screenshot (${state.screenshots.length}/${MAX_SCREENSHOTS})`;
        }
    }

    async function addScreenshots(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;

        const room = MAX_SCREENSHOTS - state.screenshots.length;
        if (room <= 0) {
            showStatus(`You can attach up to ${MAX_SCREENSHOTS} screenshots.`);
            return;
        }

        const addButton = byId('feedback-shots-add');
        if (addButton) addButton.disabled = true;
        showStatus('Preparing image…', 'info');

        const rejections = [];
        for (const file of files.slice(0, room)) {
            try {
                const prepared = await window.BARK.images.downscaleImageFile(file);
                state.screenshots.push({ id: `${Date.now()}-${state.screenshots.length}`, ...prepared });
            } catch (error) {
                rejections.push((error && error.message) || 'That image could not be attached.');
            }
        }

        if (files.length > room) {
            rejections.push(`Only ${MAX_SCREENSHOTS} screenshots fit on one report.`);
        }

        renderScreenshots();
        showStatus(rejections.length ? rejections[0] : '', 'error');
    }

    // ====== OPEN / CLOSE ======

    function focusableNodes() {
        const modal = byId('feedback-modal');
        if (!modal) return [];
        return Array.from(modal.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )).filter(node => node.offsetParent !== null || node === document.activeElement);
    }

    function trapFocus(event) {
        if (event.key !== 'Tab') return;
        const nodes = focusableNodes();
        if (!nodes.length) return;

        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function setPhase(phase) {
        state.phase = phase;
        const done = phase === 'success';
        const form = byId('feedback-form');
        const success = byId('feedback-success');
        const submit = byId('feedback-submit-btn');
        const intro = byId('feedback-intro');
        const note = byId('feedback-signed-out-note');

        if (form) form.hidden = done;
        if (success) success.hidden = !done;
        // The instructions stop being instructions once it is sent. On the way
        // back to the form, applyAuthState decides the note again.
        if (intro) intro.hidden = done;
        if (note && done) note.hidden = true;
        if (submit) {
            submit.disabled = phase === 'sending';
            submit.textContent = phase === 'sending' ? 'Sending…' : 'Send feedback';
        }
    }

    function applyAuthState() {
        const user = transport().getSignedInUser();
        const nameInput = byId('feedback-name');
        const emailInput = byId('feedback-email');
        const shotsRow = byId('feedback-shots-row');
        const note = byId('feedback-signed-out-note');

        if (nameInput) nameInput.value = (user && user.displayName) || '';
        if (emailInput) emailInput.value = (user && user.email) || '';

        // Screenshots ride on the callable, which requires auth. Signed out, the
        // report is an email only, and photos are attached in the mail app.
        if (shotsRow) shotsRow.hidden = !user;
        if (note) note.hidden = Boolean(user);
    }

    function resetForm() {
        const message = byId('feedback-message');
        if (message) message.value = '';
        state.screenshots = [];
        if (picker) picker.clear();
        setType(transport().DEFAULT_TYPE_ID);
        renderScreenshots();
        updateMessageCount();
        showStatus('');
        setPhase('form');
    }

    function open(options = {}) {
        if (!initialized) initFeedbackModal();

        const disabledMessage = feedbackDisabledMessage();
        if (disabledMessage) {
            window.alert(disabledMessage);
            return;
        }

        const overlay = byId('feedback-overlay');
        if (!overlay || !transport()) return;

        state.source = typeof options.source === 'string' && options.source.trim() ? options.source.trim() : 'manual';
        state.lastFocused = document.activeElement;

        resetForm();
        applyAuthState();

        if (options.typeId) setType(transport().getType(options.typeId).id);

        // Opened from a pin: preselect that place, still changeable.
        if (options.park && options.park.name && picker) {
            picker.select({
                kind: 'park',
                id: options.park.id || null,
                label: options.park.state ? `${options.park.name}, ${options.park.state}` : options.park.name,
                name: options.park.name
            });
            if (!options.typeId) setType('correction');
        }

        overlay.classList.add('active');
        overlay.setAttribute('aria-hidden', 'false');
        document.addEventListener('keydown', trapFocus, true);

        const message = byId('feedback-message');
        if (message) message.focus({ preventScroll: true });
    }

    function close() {
        const overlay = byId('feedback-overlay');
        if (!overlay) return;
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
        document.removeEventListener('keydown', trapFocus, true);
        if (picker) picker.close();

        if (state.lastFocused && typeof state.lastFocused.focus === 'function') {
            state.lastFocused.focus({ preventScroll: true });
        }
        state.lastFocused = null;
    }

    // ====== SUBMIT ======

    function openEmail(url) {
        try {
            window.location.href = url;
        } catch (error) {
            console.warn('[feedback] could not open the email app automatically.', error);
        }
    }

    function showSuccess({ delivered, note }) {
        const copy = byId('feedback-success-copy');
        const emailButton = byId('feedback-open-email-btn');

        if (copy) {
            copy.textContent = delivered
                ? 'Sent to the team. Your email is ready too, in case you want to add photos or say more.'
                : (note || 'Your email is ready to send.');
        }
        if (emailButton) emailButton.disabled = !state.emailUrl;

        setPhase('success');
        if (emailButton) emailButton.focus({ preventScroll: true });
    }

    async function handleSubmit(event) {
        if (event) event.preventDefault();
        if (state.phase === 'sending') return;

        const values = readForm();
        if (!values.message.trim()) {
            showStatus('Tell us what happened first, even in one line.');
            const message = byId('feedback-message');
            if (message) message.focus({ preventScroll: true });
            return;
        }

        setPhase('sending');
        showStatus('');

        const email = transport().buildEmail(values);
        state.emailUrl = email.url;

        let delivered = false;
        let note = '';

        if (transport().getSignedInUser()) {
            try {
                await transport().submitToBackend(values);
                delivered = true;
            } catch (error) {
                console.warn('[feedback] submitFeedback failed; falling back to email only.', error);
                note = transport().describeError(error);
            }
        } else {
            note = 'Your email is ready to send. Sign in next time and we get it instantly, screenshots and all.';
        }

        showSuccess({ delivered, note });

        // A programmatic mailto after an await is unreliable in the iOS standalone
        // app — it can navigate the webview away from the map. There, the button
        // in the success state is the only trigger.
        if (!isStandaloneDisplayMode()) openEmail(email.url);
    }

    // ====== INIT ======

    function bindOnce(node, type, handler) {
        if (!node || node.dataset.feedbackBound === type) return;
        node.dataset.feedbackBound = type;
        node.addEventListener(type, handler);
    }

    function initFeedbackModal() {
        if (initialized) return;
        const overlay = byId('feedback-overlay');
        if (!overlay || !transport()) return;
        initialized = true;

        // Type buttons, drawn from the transport's single list of types.
        const group = byId('feedback-type-group');
        if (group && !group.children.length) {
            transport().TYPES.forEach((type) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'feedback-type-btn';
                button.dataset.feedbackType = type.id;
                button.setAttribute('aria-pressed', 'false');

                const emoji = document.createElement('span');
                emoji.className = 'feedback-type-emoji';
                emoji.setAttribute('aria-hidden', 'true');
                emoji.textContent = type.emoji;
                button.appendChild(emoji);
                button.appendChild(document.createTextNode(type.label));

                button.addEventListener('click', () => setType(type.id));
                group.appendChild(button);
            });
        }

        picker = window.BARK.createFeedbackSubjectPicker({
            input: byId('feedback-subject-input'),
            list: byId('feedback-subject-list')
        });

        bindOnce(byId('feedback-form'), 'submit', handleSubmit);
        bindOnce(byId('feedback-message'), 'input', updateMessageCount);
        bindOnce(byId('feedback-close-btn'), 'click', close);
        bindOnce(byId('feedback-success-close-btn'), 'click', close);
        bindOnce(byId('feedback-shots-add'), 'click', () => {
            const input = byId('feedback-shots-input');
            if (input) input.click();
        });
        bindOnce(byId('feedback-shots-input'), 'change', (event) => {
            addScreenshots(event.target.files);
            event.target.value = '';   // so the same file can be re-picked after a removal
        });
        bindOnce(byId('feedback-open-email-btn'), 'click', () => {
            if (state.emailUrl) openEmail(state.emailUrl);
        });

        const bindDismissableOverlay = window.BARK.DOM && window.BARK.DOM.bindDismissableOverlay;
        if (typeof bindDismissableOverlay === 'function') {
            bindDismissableOverlay({
                overlay,
                surface: '.feedback-modal',
                boundKey: 'feedbackDismissBound',
                // The shared Escape handler listens on document in the capture
                // phase, so the combobox cannot stop it from below. While the
                // suggestion list is open the dialog reports itself unavailable
                // for dismissal, and Escape closes just the list.
                isActive: (node) => node.classList.contains('active') && !isSubjectListOpen(),
                onDismiss: close
            });
        }

        setType(transport().DEFAULT_TYPE_ID);
        updateMessageCount();
    }

    window.BARK.feedback = { open, close, initFeedbackModal };
    window.BARK.initFeedbackModal = initFeedbackModal;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFeedbackModal);
    } else {
        initFeedbackModal();
    }
})();
