"use strict";
const crypto = require("node:crypto");
const { HttpsError } = require("firebase-functions/v1/https");

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
const fingerprint = value => crypto.createHash("sha256").update(canonical(value)).digest("hex");
function priorReceipt(document, operation) {
    if (!document.exists) return null;
    const value = document.data();
    if (value.fingerprint !== fingerprint(operation)) {
        throw new HttpsError("already-exists", "This operation ID belongs to a different change.");
    }
    return value.receipt;
}
module.exports = { canonical, fingerprint, priorReceipt };
