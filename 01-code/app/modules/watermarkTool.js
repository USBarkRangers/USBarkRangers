/**
 * watermarkTool.js — stamp the B.A.R.K. Ranger logo onto a photo the user picked,
 * in whichever corner they drag it to.
 *
 * Three things drive the shape of this file:
 *
 * 1. The logo PNG is mostly empty. `WatermarkBARK.PNG` is 750x1334 but the badge
 *    only occupies (31,239)-(719,1072) of it, so 57% of the bitmap is transparent
 *    padding. Anchoring the *bitmap* to a corner pushed the visible badge inward
 *    by a fraction of its own size, which is why the logo drifted off the corner
 *    as the slider went up. `trimTransparentEdges` crops to the ink once, at load,
 *    and every measurement downstream is of the ink. Doing it at runtime rather
 *    than only re-exporting the asset means a future padded logo can't bring the
 *    bug back.
 *
 * 2. Interaction has to stay off the expensive path. The photo lives on one canvas
 *    and the logo on a second one stacked over it, so dragging clears and redraws
 *    a logo, never a 12-megapixel photo. The visible canvas is always preview-res;
 *    "Original Resolution" is an export flag, applied once in renderComposite()
 *    when the user actually saves.
 *
 * 3. Touch and mouse are one code path (Pointer Events). The drag target is a small
 *    handle sitting over the logo rather than the canvas itself, because
 *    `touch-action: none` on the whole photo would stop the page scrolling on a
 *    phone whenever a finger crossed it.
 *
 * Loaded after shareEngine.js; core/app.js calls initWatermarkTool() at boot.
 */
window.BARK = window.BARK || {};

(function () {
    'use strict';

    const PREVIEW_WIDTH = 1200;       // widest the on-screen canvas ever gets
    const BORDER_RATIO = 0.08;        // white frame, as a fraction of the photo's long edge
    const INSET_RATIO = 0.02;         // logo inset from the photo edge, fraction of photo width
    const ALPHA_FLOOR = 8;            // below this an edge pixel is antialiasing, not ink
    const DEFAULT_SIZE_PERCENT = 10;
    const SNAP_MS = 140;              // magnet animation after the finger lifts
    const GHOST_ALPHA = 0.35;         // preview of where the logo will land
    const DRAG_SLOP_PX = 3;           // below this a drag is really a tap
    const HINT_STORAGE_KEY = 'bark.watermark.dragHintSeen';

    const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    const DEFAULT_CORNER = 'bottom-right';

    const CORNER_LABELS = {
        'top-left': 'top left',
        'top-right': 'top right',
        'bottom-left': 'bottom left',
        'bottom-right': 'bottom right'
    };

    // ===================== geometry (pure, no DOM) =====================

    function isTopCorner(corner) { return corner.indexOf('top') === 0; }
    function isLeftCorner(corner) { return corner.indexOf('left') > 0; }

    /**
     * Everything the renderer needs, in canvas pixels. `photoW`/`photoH` are the
     * photo's *rendered* size (already downscaled for preview, or natural for export),
     * `logoW`/`logoH` the trimmed logo's natural size.
     *
     * The inset is one number applied on both axes and measured from the trimmed
     * box, so the four corner positions are exact mirrors of each other at any size.
     */
    function computeLayout(input) {
        const photoW = input.photoW;
        const photoH = input.photoH;
        const border = Math.round(Math.max(photoW, photoH) * BORDER_RATIO);
        const inset = photoW * INSET_RATIO;

        const scale = Math.max(0, input.sizePercent) / 100;
        const logoW = photoW * scale;
        const logoH = input.logoW > 0 ? logoW * (input.logoH / input.logoW) : 0;

        const corner = CORNERS.indexOf(input.corner) === -1 ? DEFAULT_CORNER : input.corner;
        const photoX = border;
        const photoY = border;

        return {
            border: border,
            canvasW: photoW + border * 2,
            canvasH: photoH + border * 2,
            photoX: photoX,
            photoY: photoY,
            photoW: photoW,
            photoH: photoH,
            inset: inset,
            corner: corner,
            logo: {
                x: isLeftCorner(corner) ? photoX + inset : photoX + photoW - logoW - inset,
                y: isTopCorner(corner) ? photoY + inset : photoY + photoH - logoH - inset,
                w: logoW,
                h: logoH
            }
        };
    }

    /**
     * Which corner a point belongs to. For a rectangle this is the same answer as
     * "nearest corner by distance", because the x and y comparisons are independent,
     * and it has no tie to resolve.
     */
    function cornerFromPoint(x, y, photoBox) {
        const vertical = y < photoBox.y + photoBox.h / 2 ? 'top' : 'bottom';
        const horizontal = x < photoBox.x + photoBox.w / 2 ? 'left' : 'right';
        return vertical + '-' + horizontal;
    }

    /** Step to the neighbouring corner. Used by the arrow keys. */
    function cornerAfterNudge(corner, dx, dy) {
        let vertical = isTopCorner(corner) ? 'top' : 'bottom';
        let horizontal = isLeftCorner(corner) ? 'left' : 'right';
        if (dx < 0) horizontal = 'left';
        if (dx > 0) horizontal = 'right';
        if (dy < 0) vertical = 'top';
        if (dy > 0) vertical = 'bottom';
        return vertical + '-' + horizontal;
    }

    function clamp(value, min, max) {
        return value < min ? min : (value > max ? max : value);
    }

    window.BARK.watermarkGeometry = {
        CORNERS: CORNERS,
        DEFAULT_CORNER: DEFAULT_CORNER,
        PREVIEW_WIDTH: PREVIEW_WIDTH,
        computeLayout: computeLayout,
        cornerFromPoint: cornerFromPoint,
        cornerAfterNudge: cornerAfterNudge,
        renderedPhotoSize: renderedPhotoSize
    };

    /** Photos are only ever downscaled for the preview, never blown up. */
    function renderedPhotoSize(naturalW, naturalH, fullRes) {
        if (fullRes || naturalW <= PREVIEW_WIDTH) {
            return { width: naturalW, height: naturalH };
        }
        return {
            width: PREVIEW_WIDTH,
            height: Math.round(naturalH * (PREVIEW_WIDTH / naturalW))
        };
    }

    // ===================== logo asset =====================

    /**
     * Crop a bitmap down to its visible ink. Returns a canvas, so the caller can
     * hand it straight to drawImage. Falls back to the untrimmed bitmap if the
     * pixels can't be read (a cross-origin logo would taint the canvas) or if the
     * image turns out to be entirely transparent.
     */
    function trimTransparentEdges(image) {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        const source = document.createElement('canvas');
        source.width = width;
        source.height = height;
        source.getContext('2d').drawImage(image, 0, 0);

        let pixels;
        try {
            pixels = source.getContext('2d', { willReadFrequently: true })
                .getImageData(0, 0, width, height).data;
        } catch (err) {
            return source;
        }

        let top = height, left = width, right = -1, bottom = -1;
        for (let y = 0; y < height; y++) {
            const rowStart = y * width * 4;
            for (let x = 0; x < width; x++) {
                if (pixels[rowStart + x * 4 + 3] <= ALPHA_FLOOR) continue;
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                bottom = y;
            }
        }
        if (right < left || bottom < top) return source;

        const trimmed = document.createElement('canvas');
        trimmed.width = right - left + 1;
        trimmed.height = bottom - top + 1;
        trimmed.getContext('2d').drawImage(
            source, left, top, trimmed.width, trimmed.height,
            0, 0, trimmed.width, trimmed.height
        );
        return trimmed;
    }

    /**
     * The PNG is 600KB, so it is fetched the first time someone picks a photo
     * rather than at boot. Resolves to the trimmed canvas, or null if it fails,
     * in which case the tool still works minus the logo.
     */
    let logoPromise = null;
    function loadTrimmedLogo() {
        if (logoPromise) return logoPromise;
        logoPromise = new Promise((resolve) => {
            const image = new Image();
            image.onload = () => {
                try {
                    resolve(trimTransparentEdges(image));
                } catch (err) {
                    console.warn('[watermark] could not trim the logo, using it as-is', err);
                    resolve(image);
                }
            };
            image.onerror = () => {
                console.warn('[watermark] logo failed to load');
                resolve(null);
            };
            image.src = 'assets/images/WatermarkBARK.PNG';
        });
        return logoPromise;
    }

    // ===================== rendering =====================

    function drawBase(ctx, photo, layout) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(photo, layout.photoX, layout.photoY, layout.photoW, layout.photoH);
    }

    function drawLogo(ctx, logo, box, alpha) {
        if (!logo || box.w <= 0 || box.h <= 0) return;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (alpha === undefined || alpha >= 1) {
            ctx.drawImage(logo, box.x, box.y, box.w, box.h);
            return;
        }
        const previous = ctx.globalAlpha;
        ctx.globalAlpha = alpha;
        ctx.drawImage(logo, box.x, box.y, box.w, box.h);
        ctx.globalAlpha = previous;
    }

    // ===================== the tool =====================

    function initWatermarkTool() {
        const wmUpload = document.getElementById('wm-upload');
        if (!wmUpload) return;

        const wmCanvas = document.getElementById('wm-canvas');
        const wmLogoLayer = document.getElementById('wm-logo-layer');
        const wmHandle = document.getElementById('wm-logo-handle');
        const wmStage = document.getElementById('wm-stage');
        const wmHint = document.getElementById('wm-drag-hint');
        const wmDownload = document.getElementById('wm-download');
        const wmPreviewContainer = document.getElementById('wm-preview-container');
        const wmSliderContainer = document.getElementById('wm-slider-container');
        const wmLogoSize = document.getElementById('wm-logo-size');
        const wmLogoSizeVal = document.getElementById('wm-logo-size-val');
        const wmHighRes = document.getElementById('wm-high-res');

        const baseCtx = wmCanvas.getContext('2d');
        const logoCtx = wmLogoLayer ? wmLogoLayer.getContext('2d') : null;

        // The whole tool renders from this. Nothing else holds position state.
        const state = {
            photo: null,
            logo: null,
            corner: DEFAULT_CORNER,
            sizePercent: DEFAULT_SIZE_PERCENT
        };

        function previewLayout(corner) {
            const size = renderedPhotoSize(state.photo.width, state.photo.height, false);
            return computeLayout({
                photoW: size.width,
                photoH: size.height,
                logoW: state.logo ? state.logo.width : 0,
                logoH: state.logo ? state.logo.height : 0,
                sizePercent: state.sizePercent,
                corner: corner || state.corner
            });
        }

        // ---------- base layer: photo + frame, redrawn only when the photo changes ----------

        function renderBase() {
            const layout = previewLayout();
            if (wmCanvas.width !== layout.canvasW || wmCanvas.height !== layout.canvasH) {
                wmCanvas.width = layout.canvasW;
                wmCanvas.height = layout.canvasH;
                if (wmLogoLayer) {
                    wmLogoLayer.width = layout.canvasW;
                    wmLogoLayer.height = layout.canvasH;
                }
            }
            drawBase(baseCtx, state.photo, layout);
        }

        // ---------- logo layer: cheap, redrawn on every interaction frame ----------

        /** @param box  where to draw right now (defaults to the committed corner)
         *  @param ghostCorner  corner to preview underneath, while dragging */
        function renderLogoLayer(box, ghostCorner) {
            if (!logoCtx) return;
            logoCtx.clearRect(0, 0, wmLogoLayer.width, wmLogoLayer.height);
            if (!state.logo) return;
            if (ghostCorner) {
                drawLogo(logoCtx, state.logo, previewLayout(ghostCorner).logo, GHOST_ALPHA);
            }
            drawLogo(logoCtx, state.logo, box || previewLayout().logo, 1);
        }

        /**
         * The handle is positioned in percentages of the stage, so it stays glued to
         * the logo through any responsive resize without a single measurement.
         */
        function positionHandle(box) {
            if (!wmHandle) return;
            const target = box || previewLayout().logo;
            const w = wmCanvas.width || 1;
            const h = wmCanvas.height || 1;
            wmHandle.style.left = (target.x / w * 100) + '%';
            wmHandle.style.top = (target.y / h * 100) + '%';
            wmHandle.style.width = (target.w / w * 100) + '%';
            wmHandle.style.height = (target.h / h * 100) + '%';
        }

        function describeCorner() {
            if (!wmHandle) return;
            wmHandle.setAttribute('aria-label',
                'Watermark logo, currently ' + CORNER_LABELS[state.corner] +
                '. Drag it, or use the arrow keys, to move it to another corner.');
        }

        function renderLogo(box, ghostCorner) {
            renderLogoLayer(box, ghostCorner);
            positionHandle(box);
        }

        function renderAll() {
            renderBase();
            renderLogo();
            describeCorner();
        }

        // ---------- drag ----------

        const drag = {
            pointerId: null,
            grabX: 0,           // pointer offset inside the logo box, canvas px
            grabY: 0,
            startX: 0,          // client coords at pointerdown, for the tap test
            startY: 0,
            clientX: 0,
            clientY: 0,
            rect: null,         // stage rect, cached for the life of the gesture
            moved: false,
            box: null,          // where the logo is right now, canvas px
            targetCorner: DEFAULT_CORNER,
            frame: 0
        };

        function toCanvasPoint(clientX, clientY) {
            const rect = drag.rect;
            return {
                x: (clientX - rect.left) / rect.width * wmCanvas.width,
                y: (clientY - rect.top) / rect.height * wmCanvas.height
            };
        }

        /** Where the logo sits under the finger right now, kept inside the canvas. */
        function freeBox() {
            const layout = previewLayout();
            const point = toCanvasPoint(drag.clientX, drag.clientY);
            return {
                x: clamp(point.x - drag.grabX, 0, layout.canvasW - layout.logo.w),
                y: clamp(point.y - drag.grabY, 0, layout.canvasH - layout.logo.h),
                w: layout.logo.w,
                h: layout.logo.h
            };
        }

        /**
         * Position and snap target move with the input, not with the paint. A flick
         * that starts and ends inside one frame still commits the corner the user
         * dragged to; the rAF below only decides when it gets drawn.
         */
        function updateDragTarget() {
            const layout = previewLayout();
            drag.box = freeBox();
            drag.targetCorner = cornerFromPoint(
                drag.box.x + drag.box.w / 2,
                drag.box.y + drag.box.h / 2,
                { x: layout.photoX, y: layout.photoY, w: layout.photoW, h: layout.photoH }
            );
        }

        function dragFrame() {
            drag.frame = 0;
            if (drag.pointerId === null || !drag.box) return;
            renderLogo(drag.box, drag.targetCorner);
        }

        function scheduleDragFrame() {
            if (drag.frame) return;
            drag.frame = requestAnimationFrame(dragFrame);
        }

        function prefersReducedMotion() {
            return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        }

        /** The magnet: ease from wherever the finger left the logo into the corner. */
        function animateTo(fromBox, corner) {
            // A hidden tab never fires rAF, and someone who asked for less motion
            // should just get the result. Either way, land on it now.
            if (document.hidden || prefersReducedMotion()) {
                renderLogo();
                return;
            }
            const target = previewLayout(corner).logo;
            const started = performance.now();
            (function step(now) {
                const t = Math.min(1, (now - started) / SNAP_MS);
                const eased = 1 - Math.pow(1 - t, 3);
                if (t < 1) {
                    renderLogo({
                        x: fromBox.x + (target.x - fromBox.x) * eased,
                        y: fromBox.y + (target.y - fromBox.y) * eased,
                        w: target.w,
                        h: target.h
                    });
                    requestAnimationFrame(step);
                } else {
                    renderLogo();
                }
            })(started);
        }

        function dismissHint() {
            if (!wmHint || wmHint.hidden) return;
            wmHint.hidden = true;
            try { localStorage.setItem(HINT_STORAGE_KEY, '1'); } catch (err) { /* private mode */ }
        }

        function endDrag(commit) {
            if (drag.pointerId === null) return;
            const box = drag.moved ? drag.box : null;
            if (drag.frame) { cancelAnimationFrame(drag.frame); drag.frame = 0; }
            try { wmHandle.releasePointerCapture(drag.pointerId); } catch (err) { /* already gone */ }
            drag.pointerId = null;
            if (wmStage) wmStage.classList.remove('wm-dragging');

            if (commit && drag.moved) {
                state.corner = drag.targetCorner;
                describeCorner();
                dismissHint();
            }
            if (box) {
                animateTo(box, state.corner);
            } else {
                renderLogo();
            }
        }

        if (wmHandle) {
            wmHandle.addEventListener('pointerdown', (event) => {
                if (!state.photo || !state.logo || drag.pointerId !== null) return;
                if (event.button !== undefined && event.button !== 0) return;

                // No layout, no coordinate space to map into. Bail rather than divide by zero.
                const rect = wmStage.getBoundingClientRect();
                if (!rect.width || !rect.height) return;

                event.preventDefault();
                drag.rect = rect;
                drag.pointerId = event.pointerId;
                drag.clientX = event.clientX;
                drag.clientY = event.clientY;
                drag.startX = event.clientX;
                drag.startY = event.clientY;
                drag.moved = false;
                drag.box = null;
                drag.targetCorner = state.corner;

                const point = toCanvasPoint(event.clientX, event.clientY);
                const box = previewLayout().logo;
                drag.grabX = point.x - box.x;
                drag.grabY = point.y - box.y;

                try { wmHandle.setPointerCapture(event.pointerId); } catch (err) { /* not fatal */ }
                if (wmStage) wmStage.classList.add('wm-dragging');
            });

            wmHandle.addEventListener('pointermove', (event) => {
                if (event.pointerId !== drag.pointerId) return;
                event.preventDefault();
                drag.clientX = event.clientX;
                drag.clientY = event.clientY;
                if (!drag.moved &&
                    Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > DRAG_SLOP_PX) {
                    drag.moved = true;
                }
                if (!drag.moved) return;
                updateDragTarget();
                scheduleDragFrame();
            });

            wmHandle.addEventListener('pointerup', (event) => {
                if (event.pointerId !== drag.pointerId) return;
                endDrag(true);
            });

            // Lost the gesture (a system swipe, a phone call). Put the logo back where
            // it was committed rather than guessing.
            wmHandle.addEventListener('pointercancel', (event) => {
                if (event.pointerId !== drag.pointerId) return;
                endDrag(false);
            });

            wmHandle.addEventListener('keydown', (event) => {
                const nudges = {
                    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
                };
                const nudge = nudges[event.key];
                if (!nudge || !state.photo) return;
                event.preventDefault();          // otherwise the page scrolls too
                const next = cornerAfterNudge(state.corner, nudge[0], nudge[1]);
                if (next === state.corner) return;
                const from = previewLayout().logo;
                state.corner = next;
                describeCorner();
                dismissHint();
                animateTo(from, next);
            });
        }

        // ---------- export ----------

        /**
         * The one place the full-resolution image is ever built. Same geometry as the
         * preview, so what the user dragged is what they save.
         */
        function renderComposite(fullRes) {
            const size = renderedPhotoSize(state.photo.width, state.photo.height, fullRes);
            const layout = computeLayout({
                photoW: size.width,
                photoH: size.height,
                logoW: state.logo ? state.logo.width : 0,
                logoH: state.logo ? state.logo.height : 0,
                sizePercent: state.sizePercent,
                corner: state.corner
            });
            const canvas = document.createElement('canvas');
            canvas.width = layout.canvasW;
            canvas.height = layout.canvasH;
            const ctx = canvas.getContext('2d');
            drawBase(ctx, state.photo, layout);
            drawLogo(ctx, state.logo, layout.logo, 1);
            return canvas;
        }

        // ---------- photo in, photo out ----------

        function revokePhotoUrl() {
            if (state.photo && state.photo.src && state.photo.src.startsWith('blob:')) {
                URL.revokeObjectURL(state.photo.src);
            }
        }

        wmUpload.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const objectUrl = URL.createObjectURL(file);
            const image = new Image();
            image.onload = async () => {
                revokePhotoUrl();
                state.photo = image;
                state.sizePercent = DEFAULT_SIZE_PERCENT;
                if (wmLogoSize) wmLogoSize.value = String(DEFAULT_SIZE_PERCENT);
                if (wmLogoSizeVal) wmLogoSizeVal.textContent = DEFAULT_SIZE_PERCENT + '%';

                wmPreviewContainer.style.display = 'block';
                if (wmSliderContainer) wmSliderContainer.style.display = 'block';
                wmDownload.style.display = 'inline-block';
                if (wmHint) {
                    let seen = false;
                    try { seen = localStorage.getItem(HINT_STORAGE_KEY) === '1'; } catch (err) { /* private mode */ }
                    wmHint.hidden = seen;
                }

                if (window.BARK && typeof window.BARK.perfBreadcrumb === 'function') {
                    window.BARK.perfBreadcrumb('watermark-draw:preview');
                }
                renderBase();                       // photo on screen before the logo arrives
                state.logo = await loadTrimmedLogo();
                renderAll();
            };
            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                alert('That file could not be opened as an image.');
            };
            image.src = objectUrl;
        });

        if (wmLogoSize) {
            wmLogoSize.addEventListener('input', (event) => {
                state.sizePercent = parseInt(event.target.value, 10);
                if (wmLogoSizeVal) wmLogoSizeVal.textContent = state.sizePercent + '%';
                if (state.photo) renderLogo();      // base layer is untouched
            });
        }

        const wmClearBtn = document.getElementById('wm-clear');
        if (wmClearBtn) {
            wmClearBtn.addEventListener('click', () => {
                revokePhotoUrl();
                wmUpload.value = '';
                state.photo = null;
                baseCtx.clearRect(0, 0, wmCanvas.width, wmCanvas.height);
                if (logoCtx) logoCtx.clearRect(0, 0, wmLogoLayer.width, wmLogoLayer.height);
                wmPreviewContainer.style.display = 'none';
                if (wmSliderContainer) wmSliderContainer.style.display = 'none';
                wmDownload.style.display = 'none';
            });
        }

        initSaveModal({ wmCanvas: wmCanvas, wmDownload: wmDownload, wmHighRes: wmHighRes, renderComposite: renderComposite, hasPhoto: () => Boolean(state.photo) });
    }

    // ===================== save popup (lossless PNG, share sheet, download) =====================

    function getLocalIsoDateString(date) {
        const when = date || new Date();
        const year = when.getFullYear();
        const month = String(when.getMonth() + 1).padStart(2, '0');
        const day = String(when.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    function getWatermarkPhotoFilename(date) {
        return 'USBARKRANGERSPHOTO_' + getLocalIsoDateString(date) + '.png';
    }

    function initSaveModal(deps) {
        const saveOverlay = document.getElementById('wm-save-overlay');
        const savePreview = document.getElementById('wm-save-preview');
        const saveProgress = document.getElementById('wm-save-progress');
        const saveProgressBar = document.getElementById('wm-save-progress-bar');
        const saveStatus = document.getElementById('wm-save-status');
        const saveShareBtn = document.getElementById('wm-save-share');
        const saveDownloadBtn = document.getElementById('wm-save-download');
        const saveCloseBtn = document.getElementById('wm-save-close');
        const wmDownload = deps.wmDownload;

        let currentBlob = null;          // the full-resolution lossless PNG
        let currentBlobUrl = null;       // object URL for the in-app download fallback

        function makePreviewDataUrl(sourceCanvas, maxW) {
            const scale = Math.min(1, maxW / sourceCanvas.width);
            const pc = document.createElement('canvas');
            pc.width = Math.max(1, Math.round(sourceCanvas.width * scale));
            pc.height = Math.max(1, Math.round(sourceCanvas.height * scale));
            pc.getContext('2d').drawImage(sourceCanvas, 0, 0, pc.width, pc.height);
            return pc.toDataURL('image/jpeg', 0.82);
        }

        function setProgress(pct) {
            if (saveProgressBar) saveProgressBar.style.width = pct + '%';
            if (saveProgress) saveProgress.setAttribute('aria-valuenow', String(Math.round(pct)));
        }

        function revokeBlobUrl() {
            if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
        }

        function closeSaveModal() {
            if (!saveOverlay) return;
            saveOverlay.classList.remove('active');
            saveOverlay.setAttribute('aria-hidden', 'true');
            revokeBlobUrl();
            currentBlob = null;
            if (wmDownload) wmDownload.focus({ preventScroll: true });
        }

        const canShareFiles = () => {
            try {
                return !!(navigator.canShare && navigator.share &&
                    navigator.canShare({ files: [new File([new Blob()], 'x.png', { type: 'image/png' })] }));
            } catch (e) { return false; }
        };

        /** Big canvases hold a backing store the GC is slow to reclaim; zero it out. */
        function releaseCanvas(canvas) {
            canvas.width = 0;
            canvas.height = 0;
        }

        function openSaveModal() {
            if (!deps.hasPhoto()) return;
            const wantsFullRes = Boolean(deps.wmHighRes && deps.wmHighRes.checked);

            if (!saveOverlay) {
                // Ultra-safe fallback if the modal markup is missing: blob download, never a data-URL nav.
                const composite = deps.renderComposite(wantsFullRes);
                composite.toBlob((blob) => {
                    releaseCanvas(composite);
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.download = getWatermarkPhotoFilename(); link.href = url;
                    document.body.appendChild(link); link.click(); document.body.removeChild(link);
                    setTimeout(() => URL.revokeObjectURL(url), 4000);
                }, 'image/png');
                return;
            }

            // Reset modal state.
            revokeBlobUrl();
            currentBlob = null;
            if (saveShareBtn) saveShareBtn.disabled = true;
            if (saveDownloadBtn) saveDownloadBtn.disabled = true;
            if (saveProgress) saveProgress.classList.remove('done');
            if (saveStatus) saveStatus.textContent = 'Preparing full-resolution image…';
            if (saveProgressBar) { saveProgressBar.style.transition = 'none'; }
            setProgress(0);
            if (saveProgressBar) { void saveProgressBar.offsetWidth; saveProgressBar.style.transition = ''; }

            // The thumbnail comes off a preview-res composite, so opening the modal
            // stays cheap no matter how big the photo is.
            if (savePreview) {
                const thumbSource = deps.renderComposite(false);
                savePreview.src = makePreviewDataUrl(thumbSource, 900);
                releaseCanvas(thumbSource);
            }

            // Share sheet is the primary path on mobile; hide it where files can't be shared.
            if (saveShareBtn) saveShareBtn.style.display = canShareFiles() ? 'inline-block' : 'none';

            saveOverlay.classList.add('active');
            saveOverlay.setAttribute('aria-hidden', 'false');
            if (saveCloseBtn) saveCloseBtn.focus({ preventScroll: true });

            if (window.BARK && typeof window.BARK.perfBreadcrumb === 'function') {
                window.BARK.perfBreadcrumb('watermark-encode:png');
            }

            // Kick the progress fill, then encode. Two frames let the bar paint before the
            // (main-thread-blocking) full-res compose and PNG encode begin, so the fill is visible.
            requestAnimationFrame(() => {
                setProgress(88);
                requestAnimationFrame(() => {
                    const composite = deps.renderComposite(wantsFullRes);
                    composite.toBlob((blob) => {
                        releaseCanvas(composite);
                        if (!blob) {
                            if (saveStatus) saveStatus.textContent = 'Could not prepare the image. Try again.';
                            return;
                        }
                        currentBlob = blob;
                        if (saveProgressBar) saveProgressBar.style.transition = 'width 0.25s ease';
                        setProgress(100);
                        if (saveProgress) saveProgress.classList.add('done');
                        if (saveStatus) saveStatus.textContent = 'Full-resolution image ready.';
                        if (saveShareBtn && canShareFiles()) saveShareBtn.disabled = false;
                        if (saveDownloadBtn) saveDownloadBtn.disabled = false;
                    }, 'image/png');
                });
            });
        }

        wmDownload.addEventListener('click', openSaveModal);

        if (saveShareBtn) {
            saveShareBtn.addEventListener('click', async () => {
                if (!currentBlob) return;
                const file = new File([currentBlob], getWatermarkPhotoFilename(), { type: 'image/png' });
                try {
                    await navigator.share({ files: [file], title: 'US BARK Rangers Photo' });
                    closeSaveModal();
                } catch (err) { /* user cancelled the share sheet — keep the modal open */ }
            });
        }

        if (saveDownloadBtn) {
            saveDownloadBtn.addEventListener('click', () => {
                if (!currentBlob) return;
                revokeBlobUrl();
                currentBlobUrl = URL.createObjectURL(currentBlob);
                const link = document.createElement('a');
                link.download = getWatermarkPhotoFilename();
                link.href = currentBlobUrl;
                document.body.appendChild(link); link.click(); document.body.removeChild(link);
            });
        }

        if (saveCloseBtn) saveCloseBtn.addEventListener('click', closeSaveModal);
        if (saveOverlay) {
            saveOverlay.addEventListener('click', (event) => { if (event.target === saveOverlay) closeSaveModal(); });
        }
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && saveOverlay && saveOverlay.classList.contains('active')) closeSaveModal();
        });
    }

    window.BARK.initWatermarkTool = initWatermarkTool;
})();
