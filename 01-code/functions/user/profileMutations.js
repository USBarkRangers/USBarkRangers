"use strict";
const { HttpsError } = require("firebase-functions/v1/https");

function validateOperation(operation) {
    const keys = ["id", "uid", "kind", "createdAt", "expected", "value"];
    if (!operation || typeof operation !== "object" || Array.isArray(operation)
        || Object.keys(operation).length !== keys.length || !keys.every(key => Object.hasOwn(operation, key))
        || typeof operation.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(operation.id)
        || typeof operation.uid !== "string" || !operation.uid || operation.uid.includes("/")
        || !Number.isFinite(operation.createdAt)) {
        throw new HttpsError("invalid-argument", "Invalid operation envelope.");
    }
    if (operation.kind === "profile") {
        if (typeof operation.value !== "string" || operation.value !== operation.value.trim()
            || operation.value.length < 2 || operation.value.length > 30
            || /[\p{Cc}\p{Cf}<>]/u.test(operation.value)
            || !operation.expected || typeof operation.expected !== "object"
            || Array.isArray(operation.expected)
            || Object.keys(operation.expected).sort().join(",") !== "displayName,username"
            || Object.values(operation.expected).some(v => v !== null && typeof v !== "string")) {
            throw new HttpsError("invalid-argument", "Use a display name of 2–30 characters.");
        }
    } else if (operation.kind === "mapStyle") {
        if (!["default", "satellite"].includes(operation.value)
            || (operation.expected !== null && typeof operation.expected !== "string")) {
            throw new HttpsError("invalid-argument", "Unsupported map appearance.");
        }
    } else {
        throw new HttpsError("invalid-argument", "Unsupported operation kind.");
    }
    if (Buffer.byteLength(JSON.stringify(operation)) > 4096) {
        throw new HttpsError("invalid-argument", "Operation is too large.");
    }
}
module.exports = { validateOperation };
