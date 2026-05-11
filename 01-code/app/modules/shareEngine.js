/**
 * shareEngine.js — Export Images, QR Codes, Watermark Tool, Social Sharing
 * Loaded TENTH in the boot sequence.
 */
window.BARK = window.BARK || {};

function getParkRepo() {
    return window.BARK.repos && window.BARK.repos.ParkRepo;
}

function getVaultRepo() {
    return window.BARK.repos && window.BARK.repos.VaultRepo;
}

function getShareVisitedPlacesArray() {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.getVisits === 'function') {
        return vaultRepo.getVisits();
    }

    return [];
}

function hasShareVisitedPlace(placeOrId) {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.hasVisit === 'function') {
        return vaultRepo.hasVisit(placeOrId);
    }

    return false;
}

// ====== LAZY-LOAD html2canvas ======
async function loadScreenshotEngine() {
    if (typeof html2canvas !== 'undefined') return true;
    if (window.isDownloadingCanvas) {
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (typeof html2canvas !== 'undefined') { clearInterval(check); resolve(true); }
            }, 100);
        });
    }
    window.isDownloadingCanvas = true;
    console.log("📥 Downloading screenshot engine...");
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
        script.onload = () => { window.isDownloadingCanvas = false; resolve(true); };
        script.onerror = (err) => { window.isDownloadingCanvas = false; reject(err); };
        document.head.appendChild(script);
    });
}

async function executeCanvasExport(element, filename) {
    if (!element) return;
    element.style.left = '0';
    element.style.zIndex = '9999';
    try {
        const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#0f172a' });
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        link.click();
    } catch (e) {
        console.error("Export failed", e);
        alert("Could not generate image. Please try again.");
    } finally {
        element.style.left = '-9999px';
    }
}

// ====== VAULT SHARE ======
window.shareVaultCard = async function () {
    const btn = document.getElementById('share-vault-btn');
    if (!btn) return;
    const originalText = btn.innerHTML;
    btn.innerHTML = '📸 Generating...';
    btn.disabled = true;

    try {
        await loadScreenshotEngine();
        const visitedArray = getShareVisitedPlacesArray();
        const uid = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
        const achievements = await window.gamificationEngine.evaluateAndStoreAchievements(uid, visitedArray, null, window.currentWalkPoints || 0);
        const isGlobalNumberOne = achievements.mysteryFeats.some(f => f.id === 'alphaDog' && f.status === 'unlocked');

        let allUnlocked = [...achievements.mysteryFeats, ...achievements.rareFeats, ...achievements.paws, ...achievements.stateBadges].filter(b => b.status === 'unlocked');
        allUnlocked.sort((a, b) => {
            if (a.isMystery !== b.isMystery) return a.isMystery ? -1 : 1;
            if (a.tier !== b.tier) return a.tier === 'verified' ? -1 : 1;
            return (b.dateEarnedTs || 0) - (a.dateEarnedTs || 0);
        });
        const top3 = allUnlocked.slice(0, 3);

        const titleEl = document.getElementById('export-title');
        titleEl.innerHTML = isGlobalNumberOne ? `👑 GLOBAL #1<br><span style="font-size: 50px; color: #94a3b8;">${achievements.title}</span>` : achievements.title;
        document.getElementById('export-score').textContent = `${achievements.totalScore} PTS`;

        const badgeContainer = document.getElementById('export-badges-container');
        badgeContainer.innerHTML = '';
        top3.forEach(b => {
            let bg = b.tier === 'verified' ? 'linear-gradient(135deg, #FFDF00, #DAA520, #B8860B)' : 'linear-gradient(135deg, #A0522D, #8B4513)';
            let border = b.tier === 'verified' ? '#996515' : '#5C4033';
            let textColor = b.tier === 'verified' ? '#3b2f00' : '#fffaf0';
            if (b.isMystery) { bg = 'linear-gradient(135deg, #312e81, #7e22ce, #c026d3)'; border = '#e879f9'; textColor = '#ffffff'; }
            let subtitle = b.desc || b.hint || '';
            if (!subtitle && b.id.includes('Paw')) subtitle = 'Verified Check-ins';
            if (!subtitle && b.id.includes('state')) subtitle = '100% Region Cleared';
            badgeContainer.innerHTML += `<div style="width: 240px; height: 340px; background: ${bg}; border: 6px solid ${border}; border-radius: 30px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); text-align: center; flex-shrink: 0;"><div style="font-size: 60px; margin-bottom: 12px;">${b.icon}</div><div style="font-size: 20px; font-weight: 900; color: ${textColor}; text-transform: uppercase; line-height: 1.1; margin-bottom: 12px;">${b.name}</div><div style="font-size: 13px; font-weight: 600; color: ${textColor}; opacity: 0.85; line-height: 1.4; padding: 0 10px;">${subtitle}</div></div>`;
        });

        const canvas = await html2canvas(document.getElementById('vault-export-template'), { scale: 2, useCORS: true, backgroundColor: '#0f172a' });
        canvas.toBlob(async (blob) => {
            const file = new File([blob], "My_Bark_Ranger_Vault.png", { type: "image/png" });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try { await navigator.share({ files: [file] }); } catch (err) {}
            } else {
                const link = document.createElement('a'); link.download = 'My_Bark_Ranger_Vault.png'; link.href = canvas.toDataURL('image/png'); link.click();
            }
            btn.innerHTML = originalText; btn.disabled = false;
        }, 'image/png');
    } catch (e) { alert('Export failed.'); btn.innerHTML = originalText; btn.disabled = false; }
};

// ====== SINGLE BADGE SHARE ======
window.shareSingleBadge = async function (name, icon, tier, isMystery, subtitle) {
    try {
        await loadScreenshotEngine();
        let bg = tier === 'verified' ? 'linear-gradient(135deg, #FFDF00, #DAA520, #B8860B)' : 'linear-gradient(135deg, #A0522D, #8B4513)';
        let border = tier === 'verified' ? '#996515' : '#5C4033';
        let textColor = tier === 'verified' ? '#3b2f00' : '#fffaf0';
        if (isMystery === 'true' || isMystery === true) { bg = 'linear-gradient(135deg, #312e81, #7e22ce, #c026d3)'; border = '#e879f9'; textColor = '#ffffff'; }

        const container = document.getElementById('single-export-card-container');
        container.innerHTML = `<div style="width: 500px; height: 600px; background: ${bg}; border: 12px solid ${border}; border-radius: 50px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; box-shadow: 0 40px 80px rgba(0,0,0,0.6); text-align: center;"><div style="font-size: 150px; margin-bottom: 30px; filter: drop-shadow(0 10px 10px rgba(0,0,0,0.4));">${icon}</div><div style="font-size: 48px; font-weight: 900; color: ${textColor}; text-transform: uppercase; line-height: 1.1; margin-bottom: 20px;">${name}</div><div style="font-size: 24px; font-weight: 600; color: ${textColor}; opacity: 0.9; line-height: 1.4; padding: 0 20px;">${subtitle || ''}</div></div>`;

        const canvas = await html2canvas(document.getElementById('single-export-template'), { scale: 2, useCORS: true, backgroundColor: '#0f172a' });
        canvas.toBlob(async (blob) => {
            const file = new File([blob], `Unlocked_${name.replace(/\s+/g, '_')}.png`, { type: "image/png" });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try { await navigator.share({ files: [file] }); } catch (err) {}
            } else {
                const link = document.createElement('a'); link.download = file.name; link.href = canvas.toDataURL('image/png'); link.click();
            }
        }, 'image/png');
    } catch (e) { alert('Export failed.'); }
};

// ====== EXPEDITION SHARES ======
window.shareSingleExpedition = async function () {
    await loadScreenshotEngine();
    const trailName = document.getElementById('celebration-trail-name').textContent;
    const template = document.getElementById('single-export-template');
    const container = document.getElementById('single-export-card-container');
    container.innerHTML = `<div style="background: rgba(255,255,255,0.05); border: 2px solid rgba(255,255,255,0.1); border-radius: 24px; padding: 40px; text-align: center;"><div style="font-size: 80px; margin-bottom: 20px;">🎒</div><div style="font-size: 24px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px;">EXPEDITION CONQUERED</div><div style="font-size: 60px; font-weight: 900; color: #f59e0b;">${trailName}</div></div>`;
    await executeCanvasExport(template, `Conquered_${trailName.replace(/\s+/g, '_')}.png`);
};

window.shareAllExpeditions = async function () {
    await loadScreenshotEngine();
    const template = document.getElementById('single-export-template');
    const container = document.getElementById('single-export-card-container');
    const grid = document.getElementById('completed-expeditions-grid');
    if (!grid) return;
    container.innerHTML = `<div style="font-size: 24px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 40px; text-align: center;">My Expedition Trophy Case</div><div style="display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; max-width: 900px;">${grid.innerHTML}</div>`;
    const clonedElements = container.querySelectorAll('div[style*="flex: 0 0 180px"]');
    clonedElements.forEach(el => { el.style.flex = '1 1 calc(33% - 20px)'; el.style.color = '#1e293b'; });
    await executeCanvasExport(template, 'My_Expedition_Trophy_Case.png');
};

// ====== WATERMARK TOOL ======
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
    wmDownload.addEventListener('click', () => { const link = document.createElement('a'); link.download = 'bark-ranger-swag-polaroid.jpg'; link.href = wmCanvas.toDataURL('image/jpeg', 1.0); link.click(); });
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

// ====== QR CODE ======
function initQRCode() {
    const shareSelect = document.getElementById('share-link-select');
    const qrContainer = document.getElementById('qr-code-container');
    const downloadQrBtn = document.getElementById('download-qr-btn');

    if (shareSelect && qrContainer && typeof QRCode !== 'undefined') {
        let qrcode = new QRCode(qrContainer, { text: "https://usbarkrangers.github.io/USBarkRangers/", width: 160, height: 160, colorDark: "#1976D2", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H });

        shareSelect.addEventListener('change', (e) => { let val = e.target.value; if (val === 'app') val = "https://usbarkrangers.github.io/USBarkRangers/"; qrcode.clear(); qrcode.makeCode(val); });

        if (downloadQrBtn) {
            downloadQrBtn.addEventListener('click', () => {
                const img = qrContainer.querySelector('img'); const canvas = qrContainer.querySelector('canvas');
                let dataUrl = '';
                if (img && img.src && img.src.startsWith('data:')) dataUrl = img.src;
                else if (canvas) dataUrl = canvas.toDataURL("image/png");
                if (dataUrl) { const link = document.createElement('a'); link.download = 'BarkRanger_QRCode.png'; link.href = dataUrl; document.body.appendChild(link); link.click(); document.body.removeChild(link); }
                else alert('QR Code not ready yet.');
            });
        }
    }
}

window.BARK.initQRCode = initQRCode;

// ====== CSV EXPORT ======
function initCSVExport() {
    const exportCsvBtn = document.getElementById('export-csv-btn');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', () => {
            const parkRepo = getParkRepo();
            const allPoints = parkRepo ? parkRepo.getAll() : [];
            if (!allPoints || allPoints.length === 0) { alert("Map data hasn't loaded fully yet."); return; }
            const exportData = allPoints.map(p => {
                const data = p.marker._parkData;
                const isVisited = typeof window.BARK.isParkVisited === 'function'
                    ? window.BARK.isParkVisited(data)
                    : hasShareVisitedPlace(data);
                return { Name: data.name, "Grid-Snap ID": data.id, State: data.state, Category: data.category || '', Cost: data.cost || '', "Swag Type": data.swagType || '', Latitude: data.lat, Longitude: data.lng, Visited: isVisited ? 1 : 0 };
            });
            const csvString = Papa.unparse(exportData);
            const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url); link.setAttribute('download', 'My_BarkRanger_Data.csv'); link.style.visibility = 'hidden';
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
        });
    }
}

window.BARK.initCSVExport = initCSVExport;
