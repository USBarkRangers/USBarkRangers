"use strict";

// ===== FEEDBACK SCREENSHOT INTAKE =====
// Screenshots arrive base64-encoded on the submitFeedback callable, get relayed
// to Discord, and are then dropped. Nothing reaches Firebase Storage, so this
// module is purely a gate: decode what the browser sent, prove it really is one
// of three image formats by reading the magic bytes rather than trusting the
// declared type, and hand back buffers.
//
// It never throws and knows nothing about HttpsError. Callers turn a returned
// `error` string into whatever their transport calls a bad request.

const MAX_FILES = 3;
const MAX_DECODED_BYTES = 1500000;          // ~1.5MB per image after the client downscale
const MAX_TOTAL_DECODED_BYTES = 4000000;    // keeps the whole callable request inside the 10MB cap
const MAX_NAME_LENGTH = 40;

const DATA_URL_PREFIX = /^data:[a-z0-9.+/-]*;base64,/i;
const BASE64_ONLY = /^[A-Za-z0-9+/]+={0,2}$/;
const UNSAFE_NAME_CHARS = /[^a-z0-9._-]+/gi;

// Magic bytes, not the declared mime type. A client can claim anything; these
// are the first bytes of the actual file.
function sniffImageType(buffer) {
    if (buffer.length >= 8
        && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
        && buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
        return { contentType: "image/png", extension: "png" };
    }
    if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return { contentType: "image/jpeg", extension: "jpg" };
    }
    if (buffer.length >= 12
        && buffer.toString("ascii", 0, 4) === "RIFF"
        && buffer.toString("ascii", 8, 12) === "WEBP") {
        return { contentType: "image/webp", extension: "webp" };
    }
    return null;
}

// Buffer.from(..., "base64") silently skips characters it does not understand,
// so garbage decodes to a short buffer instead of failing. Check the alphabet
// first, and size the decode from the string length so an enormous payload is
// refused before it is ever allocated.
// Returns { buffer } or { error: "unreadable" | "too_large" }.
function decodeBase64Image(value) {
    if (typeof value !== "string") return { error: "unreadable" };
    const body = value.replace(DATA_URL_PREFIX, "").replace(/\s+/g, "");
    if (!body) return { error: "unreadable" };

    // base64 carries 3 bytes per 4 characters; padding makes it at most 2 short.
    if (Math.floor(body.length / 4) * 3 > MAX_DECODED_BYTES + 3) return { error: "too_large" };
    if (body.length % 4 !== 0 || !BASE64_ONLY.test(body)) return { error: "unreadable" };

    const buffer = Buffer.from(body, "base64");
    if (!buffer.length) return { error: "unreadable" };
    if (buffer.length > MAX_DECODED_BYTES) return { error: "too_large" };
    return { buffer };
}

function safeFileName(rawName, index, extension) {
    const base = String(rawName || "")
        .split(/[\\/]/).pop()
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(UNSAFE_NAME_CHARS, "-")
        .replace(/^[-.]+|[-.]+$/g, "")
        .slice(0, MAX_NAME_LENGTH);
    return `${base || `screenshot-${index + 1}`}.${extension}`;
}

function fail(message) {
    return { files: [], error: message };
}

// Returns { files, error }. `files` entries are { name, contentType, buffer },
// ready to hand to the Discord transport.
function normalizeFeedbackScreenshots(value) {
    if (value === undefined || value === null || value === "") return { files: [], error: null };
    if (!Array.isArray(value)) return fail("Screenshots must be sent as a list.");
    if (value.length === 0) return { files: [], error: null };
    if (value.length > MAX_FILES) return fail(`Please attach ${MAX_FILES} screenshots or fewer.`);

    const files = [];
    let totalBytes = 0;

    for (let index = 0; index < value.length; index += 1) {
        const entry = value[index];
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return fail("Each screenshot must include image data.");
        }

        const decoded = decodeBase64Image(entry.dataBase64 || entry.data);
        if (decoded.error === "too_large") {
            return fail(`Each screenshot must be ${Math.round(MAX_DECODED_BYTES / 100000) / 10}MB or smaller.`);
        }
        if (decoded.error) return fail("A screenshot could not be read. Please try attaching it again.");

        const buffer = decoded.buffer;
        const sniffed = sniffImageType(buffer);
        if (!sniffed) return fail("Screenshots must be PNG, JPEG, or WebP images.");

        totalBytes += buffer.length;
        if (totalBytes > MAX_TOTAL_DECODED_BYTES) {
            return fail("Those screenshots are too large together. Please attach fewer or smaller images.");
        }

        files.push({
            name: safeFileName(entry.name, index, sniffed.extension),
            contentType: sniffed.contentType,
            buffer
        });
    }

    return { files, error: null };
}

module.exports = {
    normalizeFeedbackScreenshots,
    sniffImageType,
    decodeBase64Image,
    safeFileName,
    MAX_FILES,
    MAX_DECODED_BYTES,
    MAX_TOTAL_DECODED_BYTES
};
