const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    normalizeFeedbackScreenshots,
    sniffImageType,
    safeFileName,
    MAX_DECODED_BYTES
} = require("../feedbackAttachments.js");

// Every buffer here is a real header plus filler: the module reads magic bytes,
// so a fake "image" of zeroes would be rejected for the wrong reason.

const PNG_HEADER = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const JPEG_HEADER = [0xFF, 0xD8, 0xFF, 0xE0];

function pngBuffer(padBytes = 16) {
    return Buffer.concat([Buffer.from(PNG_HEADER), Buffer.alloc(padBytes, 0x21)]);
}

function jpegBuffer(padBytes = 16) {
    return Buffer.concat([Buffer.from(JPEG_HEADER), Buffer.alloc(padBytes, 0x21)]);
}

function webpBuffer(padBytes = 16) {
    return Buffer.concat([
        Buffer.from("RIFF", "ascii"),
        Buffer.alloc(4, 0x10),
        Buffer.from("WEBP", "ascii"),
        Buffer.alloc(padBytes, 0x21)
    ]);
}

function screenshot(buffer, overrides = {}) {
    return Object.assign({
        name: "shot.png",
        mimeType: "image/png",
        dataBase64: buffer.toString("base64")
    }, overrides);
}

describe("sniffImageType", () => {
    it("recognizes the three allowed formats", () => {
        assert.equal(sniffImageType(pngBuffer()).contentType, "image/png");
        assert.equal(sniffImageType(jpegBuffer()).contentType, "image/jpeg");
        assert.equal(sniffImageType(webpBuffer()).contentType, "image/webp");
    });

    it("rejects anything else", () => {
        assert.equal(sniffImageType(Buffer.from("GIF89a-and-then-some", "ascii")), null);
        assert.equal(sniffImageType(Buffer.from("%PDF-1.7 not an image", "ascii")), null);
        assert.equal(sniffImageType(Buffer.from([0x89, 0x50])), null);
    });
});

describe("normalizeFeedbackScreenshots", () => {
    it("treats a missing or empty list as no screenshots", () => {
        for (const value of [undefined, null, "", []]) {
            const result = normalizeFeedbackScreenshots(value);
            assert.equal(result.error, null);
            assert.deepEqual(result.files, []);
        }
    });

    it("decodes valid images and keeps the sniffed type", () => {
        const result = normalizeFeedbackScreenshots([
            screenshot(pngBuffer()),
            screenshot(jpegBuffer(), { name: "photo.jpg" }),
            screenshot(webpBuffer(), { name: "clip.webp" })
        ]);

        assert.equal(result.error, null);
        assert.equal(result.files.length, 3);
        assert.deepEqual(
            result.files.map((file) => file.contentType),
            ["image/png", "image/jpeg", "image/webp"]
        );
        assert.deepEqual(
            result.files.map((file) => file.name),
            ["shot.png", "photo.jpg", "clip.webp"]
        );
        assert.ok(Buffer.isBuffer(result.files[0].buffer));
    });

    it("accepts a data URL prefix from a canvas export", () => {
        const buffer = pngBuffer();
        const result = normalizeFeedbackScreenshots([
            screenshot(buffer, { dataBase64: `data:image/png;base64,${buffer.toString("base64")}` })
        ]);

        assert.equal(result.error, null);
        assert.equal(result.files.length, 1);
        assert.deepEqual(result.files[0].buffer, buffer);
    });

    it("trusts the magic bytes over the declared mime type", () => {
        const disguised = normalizeFeedbackScreenshots([
            screenshot(Buffer.from("#!/bin/sh\nrm -rf /\n", "ascii"), { mimeType: "image/png" })
        ]);
        assert.match(disguised.error, /PNG, JPEG, or WebP/);
        assert.deepEqual(disguised.files, []);

        // A real JPEG mislabeled as PNG is still a real image, and is kept as JPEG.
        const mislabeled = normalizeFeedbackScreenshots([
            screenshot(jpegBuffer(), { mimeType: "image/png", name: "shot.png" })
        ]);
        assert.equal(mislabeled.error, null);
        assert.equal(mislabeled.files[0].contentType, "image/jpeg");
        assert.equal(mislabeled.files[0].name, "shot.jpg");
    });

    it("rejects more than three screenshots", () => {
        const result = normalizeFeedbackScreenshots(new Array(4).fill(screenshot(pngBuffer())));
        assert.match(result.error, /3 screenshots or fewer/);
    });

    it("rejects a single oversized image", () => {
        const result = normalizeFeedbackScreenshots([screenshot(pngBuffer(MAX_DECODED_BYTES + 1))]);
        assert.match(result.error, /or smaller/);
    });

    it("rejects images that are too large together", () => {
        const nearMax = pngBuffer(MAX_DECODED_BYTES - PNG_HEADER.length);
        const result = normalizeFeedbackScreenshots([
            screenshot(nearMax),
            screenshot(nearMax),
            screenshot(nearMax)
        ]);
        assert.match(result.error, /too large together/);
    });

    it("rejects malformed base64 instead of silently decoding garbage", () => {
        const result = normalizeFeedbackScreenshots([screenshot(pngBuffer(), { dataBase64: "not really base64!!" })]);
        assert.match(result.error, /could not be read/);
    });

    it("rejects a non-array payload and non-object entries", () => {
        assert.match(normalizeFeedbackScreenshots("iVBORw0KGgo=").error, /list/);
        assert.match(normalizeFeedbackScreenshots([null]).error, /image data/);
        assert.match(normalizeFeedbackScreenshots(["iVBORw0KGgo="]).error, /image data/);
    });
});

describe("safeFileName", () => {
    it("strips paths and forces the sniffed extension", () => {
        assert.equal(safeFileName("../../etc/passwd", 0, "png"), "passwd.png");
        assert.equal(safeFileName("my photo (1).HEIC", 0, "jpg"), "my-photo-1.jpg");
        assert.equal(safeFileName("", 2, "webp"), "screenshot-3.webp");
        assert.equal(safeFileName("...", 0, "png"), "screenshot-1.png");
    });
});
