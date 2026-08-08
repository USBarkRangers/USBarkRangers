/**
 * watermarkTool.js — stamp the B.A.R.K. Ranger logo onto a photo the user picked.
 *
 * Lifted out of shareEngine.js, which had grown into five unrelated exporters
 * sharing one file. Nothing about the behaviour changed in the move.
 *
 * Loaded after shareEngine.js; core/app.js calls initWatermarkTool() at boot.
 */
window.BARK = window.BARK || {};

function getLocalIsoDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getWatermarkPhotoFilename(date = new Date()) {
    return `USBARKRANGERSPHOTO_${getLocalIsoDateString(date)}.png`;
}

function initWatermarkTool() {
    const wmUpload = document.getElementById('wm-upload');
    const wmCanvas = document.getElementById('wm-canvas');
    const wmDownload = document.getElementById('wm-download');
    const wmSliderContainer = document.getElementById('wm-slider-container');
    const wmLogoSize = document.getElementById('wm-logo-size');
    const wmLogoSizeVal = document.getElementById('wm-logo-size-val');
    const wmHighRes = document.getElementById('wm-high-res');
    let currentPhotoImg = null;
    let currentLogoImg = null;

    if (!wmUpload) return;

    currentLogoImg = new Image();
    currentLogoImg.src = 'assets/images/WatermarkBARK.PNG';

    function drawWatermark(logoScalePercent) {
        if (!currentPhotoImg || !currentLogoImg) return;
        const ctx = wmCanvas.getContext('2d');
        const isFullRes = wmHighRes && wmHighRes.checked;
        if (window.BARK && typeof window.BARK.perfBreadcrumb === 'function') {
            window.BARK.perfBreadcrumb('watermark-draw:' + (isFullRes ? 'full' : 'preview'));
        }
        const PREVIEW_WIDTH = 1200;
        let width = currentPhotoImg.width, height = currentPhotoImg.height;
        if (!isFullRes && width > PREVIEW_WIDTH) { height = height * (PREVIEW_WIDTH / width); width = PREVIEW_WIDTH; }
        const borderSize = Math.max(width, height) * 0.08;
        const canvasWidth = width + borderSize * 2, canvasHeight = height + borderSize * 2;
        wmCanvas.width = canvasWidth; wmCanvas.height = canvasHeight;
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.drawImage(currentPhotoImg, borderSize, borderSize, width, height);
        const scaleFactor = logoScalePercent / 100;
        const logoWidthPx = width * scaleFactor;
        const logoHeightPx = currentLogoImg.height * (logoWidthPx / currentLogoImg.width);
        const margin = width * 0.02;
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(currentLogoImg, borderSize + width - logoWidthPx - margin, borderSize + height - logoHeightPx - margin, logoWidthPx, logoHeightPx);
        document.getElementById('wm-preview-container').style.display = 'block';
        if (wmSliderContainer) wmSliderContainer.style.display = 'block';
        wmDownload.style.display = 'inline-block';
    }

    if (wmLogoSize) { wmLogoSize.addEventListener('input', (e) => { wmLogoSizeVal.textContent = e.target.value + '%'; drawWatermark(parseInt(e.target.value, 10)); }); }
    wmUpload.addEventListener('change', (e) => {
        const file = e.target.files[0]; if (!file) return;
        if (currentPhotoImg && currentPhotoImg.src && currentPhotoImg.src.startsWith('blob:')) URL.revokeObjectURL(currentPhotoImg.src);
        const img = new Image();
        img.onload = () => { currentPhotoImg = img; if (wmLogoSize) { wmLogoSize.value = 10; wmLogoSizeVal.textContent = '10%'; } drawWatermark(10); };
        img.src = URL.createObjectURL(file);
    });
    // ===== Save popup (lossless PNG, native share sheet, in-app download) =====
    const saveOverlay = document.getElementById('wm-save-overlay');
    const savePreview = document.getElementById('wm-save-preview');
    const saveProgress = document.getElementById('wm-save-progress');
    const saveProgressBar = document.getElementById('wm-save-progress-bar');
    const saveStatus = document.getElementById('wm-save-status');
    const saveShareBtn = document.getElementById('wm-save-share');
    const saveDownloadBtn = document.getElementById('wm-save-download');
    const saveCloseBtn = document.getElementById('wm-save-close');

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

    function openSaveModal() {
        if (!saveOverlay) {
            // Ultra-safe fallback if the modal markup is missing: blob download, never a data-URL nav.
            wmCanvas.toBlob((blob) => {
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
        if (savePreview) savePreview.src = makePreviewDataUrl(wmCanvas, 900);

        // Share sheet is the primary path on mobile; hide it where files can't be shared.
        if (saveShareBtn) saveShareBtn.style.display = canShareFiles() ? 'inline-block' : 'none';

        saveOverlay.classList.add('active');
        saveOverlay.setAttribute('aria-hidden', 'false');
        if (saveCloseBtn) saveCloseBtn.focus({ preventScroll: true });

        if (window.BARK && typeof window.BARK.perfBreadcrumb === 'function') {
            window.BARK.perfBreadcrumb('watermark-encode:png');
        }

        // Kick the progress fill, then encode. Two frames let the bar paint before the
        // (main-thread-blocking) PNG encode begins, so the fill is visible.
        requestAnimationFrame(() => {
            setProgress(88);
            requestAnimationFrame(() => {
                wmCanvas.toBlob((blob) => {
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

    if (wmHighRes) { wmHighRes.addEventListener('change', () => drawWatermark(parseInt(wmLogoSize.value, 10))); }

    const wmClearBtn = document.getElementById('wm-clear');
    if (wmClearBtn) {
        wmClearBtn.addEventListener('click', () => {
            if (currentPhotoImg && currentPhotoImg.src && currentPhotoImg.src.startsWith('blob:')) URL.revokeObjectURL(currentPhotoImg.src);
            wmUpload.value = '';
            const ctx = wmCanvas.getContext('2d'); ctx.clearRect(0, 0, wmCanvas.width, wmCanvas.height);
            currentPhotoImg = null;
            document.getElementById('wm-preview-container').style.display = 'none';
            if (wmSliderContainer) wmSliderContainer.style.display = 'none';
            wmDownload.style.display = 'none';
        });
    }
}

window.BARK.initWatermarkTool = initWatermarkTool;
