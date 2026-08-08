/**
 * imageDownscale.js — turn a picked photo into something small enough to send.
 *
 * A modern phone screenshot is 3-8MB and a photo can be far more. The feedback
 * callable accepts base64 in the request body, so anything large has to shrink
 * before it leaves the browser. Everything here re-encodes to JPEG: it is the
 * one format every canvas can write, and screenshots survive it fine.
 *
 * Output is base64 without the data-URL prefix, which is exactly what
 * functions/feedbackAttachments.js expects.
 */
window.BARK = window.BARK || {};

(function () {
    const TARGET_LONG_EDGE = 1600;
    const MAX_SOURCE_BYTES = 40 * 1024 * 1024;   // a sanity bound on the picked file
    const MAX_OUTPUT_BYTES = 1400000;            // under the callable's 1.5MB per-image cap

    // Tried in order until one lands under MAX_OUTPUT_BYTES. A 1600px screenshot
    // at 0.8 is normally 200-400KB, so the later steps are for huge photos only.
    const ENCODE_STEPS = [
        { longEdge: TARGET_LONG_EDGE, quality: 0.8 },
        { longEdge: TARGET_LONG_EDGE, quality: 0.6 },
        { longEdge: 1200, quality: 0.6 },
        { longEdge: 900, quality: 0.5 }
    ];

    function isImageFile(file) {
        return Boolean(file && typeof file.type === 'string' && file.type.startsWith('image/'));
    }

    function scaledSize(width, height, longEdge) {
        const largest = Math.max(width, height);
        if (!largest) return null;
        const ratio = Math.min(1, longEdge / largest);
        return {
            width: Math.max(1, Math.round(width * ratio)),
            height: Math.max(1, Math.round(height * ratio))
        };
    }

    // createImageBitmap is the cheap path and honours EXIF orientation when the
    // browser supports the option. Safari has been inconsistent about both, so
    // an <img> decode stays as the fallback — it applies orientation natively.
    function decodeWithImageElement(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
                URL.revokeObjectURL(url);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('decode-failed'));
            };
            image.src = url;
        });
    }

    async function decodeImage(file) {
        if (typeof createImageBitmap === 'function') {
            try {
                return await createImageBitmap(file, { imageOrientation: 'from-image' });
            } catch (error) {
                try {
                    return await createImageBitmap(file);
                } catch (fallbackError) {
                    /* fall through to the <img> path */
                }
            }
        }
        return decodeWithImageElement(file);
    }

    function encode(source, sourceWidth, sourceHeight, step) {
        const size = scaledSize(sourceWidth, sourceHeight, step.longEdge);
        if (!size) return null;

        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;

        const context = canvas.getContext('2d');
        if (!context) return null;
        context.drawImage(source, 0, 0, size.width, size.height);

        const dataUrl = canvas.toDataURL('image/jpeg', step.quality);

        // iOS reclaims canvas memory late; zeroing the dimensions frees it now.
        canvas.width = 0;
        canvas.height = 0;

        const base64 = String(dataUrl).split(',')[1] || '';
        if (!base64) return null;

        return {
            dataBase64: base64,
            bytes: Math.floor(base64.length * 3 / 4),
            width: size.width,
            height: size.height
        };
    }

    function jpegName(rawName) {
        const base = String(rawName || 'screenshot').split(/[\\/]/).pop().replace(/\.[a-z0-9]+$/i, '');
        return `${base || 'screenshot'}.jpg`;
    }

    /**
     * Resolves to { name, mimeType, dataBase64, bytes, width, height }.
     * Rejects with an Error whose message is safe to show the user.
     */
    async function downscaleImageFile(file) {
        if (!isImageFile(file)) throw new Error('That file is not an image.');
        if (file.size > MAX_SOURCE_BYTES) throw new Error('That image is too large to attach.');

        let decoded;
        try {
            decoded = await decodeImage(file);
        } catch (error) {
            throw new Error('That image could not be opened on this device.');
        }

        const sourceWidth = decoded.width || decoded.naturalWidth;
        const sourceHeight = decoded.height || decoded.naturalHeight;

        try {
            let smallest = null;
            for (const step of ENCODE_STEPS) {
                const encoded = encode(decoded, sourceWidth, sourceHeight, step);
                if (!encoded) continue;
                if (!smallest || encoded.bytes < smallest.bytes) smallest = encoded;
                if (encoded.bytes <= MAX_OUTPUT_BYTES) break;
            }

            if (!smallest) throw new Error('That image could not be prepared on this device.');
            if (smallest.bytes > MAX_OUTPUT_BYTES) throw new Error('That image is too detailed to attach. Try a screenshot instead.');

            return {
                name: jpegName(file.name),
                mimeType: 'image/jpeg',
                dataBase64: smallest.dataBase64,
                bytes: smallest.bytes,
                width: smallest.width,
                height: smallest.height
            };
        } finally {
            if (decoded && typeof decoded.close === 'function') decoded.close();
        }
    }

    window.BARK.images = {
        downscaleImageFile,
        // Exposed for tests: the sizing arithmetic is the part worth pinning.
        scaledSize,
        jpegName
    };
})();
