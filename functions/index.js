const functions = require('firebase-functions/v1');
const admin = require("firebase-admin");
const axios = require("axios");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const { randomUUID } = require("crypto");

// Initialize Firebase Admin SDK
admin.initializeApp();

// Keep admin callables compatible with the current admin page. The backend
// still enforces signed-in admin status plus per-admin rate limits.
const ADMIN_CALLABLE_OPTIONS = {};

const ADMIN_RATE_LIMITS = {
    extractParkData: { maxRequests: 20, windowMs: 60 * 1000 },
    syncToSpreadsheet: { maxRequests: 10, windowMs: 60 * 1000 }
};

function getCallableUid(context) {
    return context && context.auth && context.auth.uid ? context.auth.uid : null;
}

async function isAdminUser(uid, token = {}) {
    if (token.admin === true || token.isAdmin === true) return true;

    const userDoc = await admin.firestore().collection("users").doc(uid).get();
    return userDoc.exists && userDoc.data() && userDoc.data().isAdmin === true;
}

async function enforceAdminRateLimit(uid, action) {
    const limit = ADMIN_RATE_LIMITS[action];
    if (!limit) return;

    const now = Date.now();
    const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs;
    const windowEndsAt = windowStart + limit.windowMs;
    const safeUid = encodeURIComponent(uid);
    const safeAction = encodeURIComponent(action);
    const ref = admin.firestore()
        .collection("_adminRateLimits")
        .doc(`${safeAction}_${safeUid}_${windowStart}`);

    await admin.firestore().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const currentCount = snapshot.exists ? Number(snapshot.data().count || 0) : 0;

        if (currentCount >= limit.maxRequests) {
            const retrySeconds = Math.max(1, Math.ceil((windowEndsAt - now) / 1000));
            throw new functions.https.HttpsError(
                "resource-exhausted",
                `Rate limit exceeded. Try again in ${retrySeconds} seconds.`
            );
        }

        transaction.set(ref, {
            uid,
            action,
            count: currentCount + 1,
            windowStart: admin.firestore.Timestamp.fromMillis(windowStart),
            windowEndsAt: admin.firestore.Timestamp.fromMillis(windowEndsAt),
            expiresAt: admin.firestore.Timestamp.fromMillis(windowEndsAt + 24 * 60 * 60 * 1000),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });
}

async function requireAdminCallable(context, action) {
    const uid = getCallableUid(context);
    if (!uid) {
        throw new functions.https.HttpsError("unauthenticated", "Sign in is required.");
    }

    const adminAllowed = await isAdminUser(uid, context.auth.token || {});
    if (!adminAllowed) {
        throw new functions.https.HttpsError("permission-denied", "Admin access is required.");
    }

    await enforceAdminRateLimit(uid, action);
}

function requireAuthCallable(context) {
    const uid = getCallableUid(context);
    if (!uid) {
        throw new functions.https.HttpsError("unauthenticated", "Sign in is required.");
    }
    return uid;
}

function throwHttpsError(error, fallbackMessage) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError("internal", fallbackMessage);
}

const CANONICAL_PARK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanSheetCell(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function getCanonicalParkId(value) {
    const parkId = cleanSheetCell(value);
    return CANONICAL_PARK_ID_PATTERN.test(parkId) ? parkId : '';
}

// ============================================================================
// 1. LEGACY MAP FUNCTIONS (ROUTING & LEADERBOARD)
// ============================================================================

exports.getPremiumRoute = functions
    .runWith({ secrets: ["ORS_API_KEY"] })
    .https.onCall(async (requestOrData, context) => {
        requireAuthCallable(context);

        const payload = requestOrData.data ? requestOrData.data : requestOrData;
        const coordinates = payload.coordinates;
        const radiuses = payload.radiuses;

        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            throw new functions.https.HttpsError("invalid-argument", "Payload mismatch!");
        }

        const apiKey = process.env.ORS_API_KEY;
        if (!apiKey) {
            throw new functions.https.HttpsError("failed-precondition", "Routing service is not configured.");
        }

        const url = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";
        const body = { coordinates };
        if (Array.isArray(radiuses) && radiuses.length === coordinates.length) {
            body.radiuses = radiuses;
        }

        try {
            const response = await axios.post(url, body, {
                headers: {
                    "Authorization": apiKey,
                    "Content-Type": "application/json",
                    "Accept": "application/json, application/geo+json; charset=utf-8"
                }
            });
            return response.data;
        } catch (error) {
            console.error("Networking/ORS Error:", error.message);
            throw new functions.https.HttpsError("internal", "Failed to calculate route.");
        }
    });

exports.getPremiumGeocode = functions
    .runWith({ secrets: ["ORS_API_KEY"] })
    .https.onCall(async (requestOrData, context) => {
        requireAuthCallable(context);

        const payload = requestOrData.data ? requestOrData.data : requestOrData;
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';

        if (!text) {
            throw new functions.https.HttpsError("invalid-argument", "Search query is required.");
        }

        const apiKey = process.env.ORS_API_KEY;
        if (!apiKey) {
            throw new functions.https.HttpsError("failed-precondition", "Geocoding service is not configured.");
        }

        const requestedSize = parseInt(payload.size, 10);
        const size = Number.isFinite(requestedSize) ? Math.min(Math.max(requestedSize, 1), 10) : 5;

        const params = new URLSearchParams({
            api_key: apiKey,
            text,
            size: String(size)
        });
        if (payload.country) {
            params.set('boundary.country', String(payload.country));
        }

        try {
            const response = await axios.get(`https://api.openrouteservice.org/geocode/search?${params.toString()}`);
            return response.data;
        } catch (error) {
            console.error("Networking/ORS Geocode Error:", error.message);
            throw new functions.https.HttpsError("internal", "Failed to perform geocode.");
        }
    });

exports.generateHourlyLeaderboard = functions.pubsub.schedule("0 * * * *")
    .timeZone("America/New_York")
    .onRun(async (context) => {
        const db = admin.firestore();
        try {
            const snapshot = await db.collection("leaderboard").orderBy("totalPoints", "desc").limit(100).get();
            const leaderboardArray = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                leaderboardArray.push({
                    uid: doc.id,
                    displayName: data.displayName || "Anonymous Ranger",
                    totalPoints: data.totalPoints || data.totalVisited || 0,
                    totalVisited: data.totalVisited || 0,
                    hasVerified: !!data.hasVerified
                });
            });
            await db.collection("system").doc("leaderboardData").set({
                topUsers: leaderboardArray,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
            return null;
        } catch (error) {
            console.error("Error generating leaderboard:", error);
            return null;
        }
    });

// ============================================================================
// 2. DATA REFINERY: GEMINI AI EXTRACTION
// ============================================================================

// ============================================================================
// 1. DATA REFINERY: GEMINI AI EXTRACTION (The "Bouncer")
// ============================================================================
exports.extractParkData = functions
    .runWith({ ...ADMIN_CALLABLE_OPTIONS, secrets: ["GEMINI_API_KEY", "GEMINI_PAID_API_KEY"], memory: '1GB' })
    .https.onCall(async (data, context) => {
        await requireAdminCallable(context, "extractParkData");

        try {
            const payload = data || {};
            // Read the route from the frontend, default to free-3
            const engineRoute = payload.engineRoute || "free-3";
            
            let targetApiKey = "";
            let targetModelName = "";

            // --- THE 7-WAY ROUTING LOGIC ---
            if (engineRoute === "free-3") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-3-flash-preview";
            } 
            else if (engineRoute === "free-31-lite") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-3.1-flash-lite-preview"; 
            }
            else if (engineRoute === "free-25") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-2.5-flash";
            }
            else if (engineRoute === "free-25-lite") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-2.5-flash-lite";
            }
            else if (engineRoute === "free-20") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-2.0-flash";
            }
            else if (engineRoute === "free-20-lite") {
                targetApiKey = process.env.GEMINI_API_KEY;
                targetModelName = "gemini-2.0-flash-lite";
            }
            else if (engineRoute === "paid-3") {
                targetApiKey = process.env.GEMINI_PAID_API_KEY;
                targetModelName = "gemini-3-flash-preview";
            }

            if (!targetApiKey) {
                throw new functions.https.HttpsError("failed-precondition", "AI extraction key is not configured for the selected engine.");
            }

            // Initialize the AI with the dynamically selected key and model
            const genAI = new GoogleGenerativeAI(targetApiKey);
            const model = genAI.getGenerativeModel({ model: targetModelName });

            const prompt = `You are a strict data extraction parser for a National Park accessibility database. 
            Analyze the provided text or sequence of images (labeled with their filenames) and extract the B.A.R.K. Ranger data.
            
            CRITICAL FILTERING RULES:
            1. IGNORE restaurants, pubs, city dog parks, festivals, and personal side-trips.
            2. ONLY extract official National Parks, State Parks, National Historic Sites, or locations explicitly stating they have a B.A.R.K. Ranger program.
            
            DATA EXTRACTION RULES:
            - approvedTrails: Specific trails or areas where dogs ARE allowed.
            - strictRules: Where dogs are NOT allowed, stroller rules, and BARK Ranger tag requirements.
            - hazards: Physical dangers or product issues (e.g., weak tag hooks).

            OUTPUT FORMAT:
            You must output an ARRAY of JSON objects. If the post mentions multiple valid parks, create an object for each. 
            
            [
              {
                "sourceImage": "IMG_2281.PNG", // CRITICAL: Use the exact filename provided for the image (e.g., 'IMG_2281.PNG' or 'Text' if not an image).
                "dateFound": "April 2026", // Extract the date the post was made if visible in the text or header.
                "parkName": "Name of official park",
                "entranceFee": "...",
                "swagLocation": "...",
                "approvedTrails": "...",
                "strictRules": "...",
                "hazards": "...",
                "extraSwag": "..."
              }
            ]
            
            Output ONLY a valid JSON array. No markdown, no explanations.`;

            let parts = [];
            
            // 1. TRUE BUNDLE BATCHING: Now with filenames
            if (payload.images && payload.images.length > 0) {
                payload.images.forEach((imgObj) => {
                    const cleanBase64 = imgObj.data.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
                    
                    // We label the part so the AI knows which name belongs to which image
                    parts.push(`--- START OF IMAGE: ${imgObj.name} ---`);
                    parts.push({ inlineData: { data: cleanBase64, mimeType: "image/jpeg" } });
                });
                // Add the text prompt at the very end of the pile
                parts.push(prompt);
            } 
            // 2. Fallback for a single image
            else if (payload.image) {
                const base64String = payload.image.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
                parts = [{ inlineData: { data: base64String, mimeType: "image/jpeg" } }, prompt];
            } 
            // 3. Fallback for raw text
            else {
                parts = [payload.text, prompt];
            }

            const result = await model.generateContent(parts);
            const responseText = result.response.text();
            const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const aiData = JSON.parse(cleanedText);
            console.log("AI RAW OUTPUT:", JSON.stringify(aiData, null, 2));
            return aiData;
        } catch (error) {
            console.error("AI Error:", error);
            throwHttpsError(error, error.message || "AI extraction failed.");
        }
    });

// ============================================================================
// 2. SPREADSHEET BRIDGE: THE NEW SITE GUARDRAIL
// ============================================================================
exports.syncToSpreadsheet = functions
    .runWith(ADMIN_CALLABLE_OPTIONS)
    .https.onCall(async (data, context) => {
        await requireAdminCallable(context, "syncToSpreadsheet");

        try {
            const auth = new google.auth.GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
            const sheets = google.sheets({ version: 'v4', auth });

            const spreadsheetId = '1fnlZfRbfQIy-o2Df6FgEdTMw9OWTR3-JX011s-7oWlE'; 
            const sheetName = 'National B.A.R.K Ranger'; 
            const newPark = data; 

            // 1. Fetch the ENTIRE row through Park ID so updates can preserve it.
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: `'${sheetName}'!A:P`,
            });

            const rows = response.data.values || [];
        
        // --- HIGH-PRECISION MATCHING ENGINE ---
        const superNormalize = (str) => {
            let s = str.toLowerCase();
            s = s.replace(/\./g, ' '); 
            s = s.replace(/&/g, 'and');
            s = s.replace(/\bmt\b/g, 'mount');
            s = s.replace(/\bft\b/g, 'fort');
            s = s.replace(/\bst\b/g, 'saint');
            s = s.replace(/\bnp\b/g, 'national park');
            s = s.replace(/\bnm\b/g, 'national monument');
            s = s.replace(/\bnhs\b/g, 'national historic site');
            s = s.replace(/\bnra\b/g, 'national recreation area');
            s = s.replace(/\b96\b/g, 'ninetysix');
            return s.replace(/[^a-z0-9]/g, '');
        };
        
        const aiNameNorm = superNormalize(newPark.parkName);
        let bestMatch = { rowIndex: -1, score: 0, lengthDiff: 999 };

        for (let i = 0; i < rows.length; i++) {
            if (!rows[i][0]) continue;
            
            const sheetNameNorm = superNormalize(rows[i][0]);
            let currentScore = 0;

            if (sheetNameNorm === aiNameNorm) {
                currentScore = 100;
            } else if (sheetNameNorm.includes(aiNameNorm) || aiNameNorm.includes(sheetNameNorm)) {
                currentScore = 80;
            }

            const currentDiff = Math.abs(sheetNameNorm.length - aiNameNorm.length);

            if (currentScore > bestMatch.score) {
                bestMatch = { rowIndex: i + 1, score: currentScore, lengthDiff: currentDiff };
            } else if (currentScore === bestMatch.score && currentScore > 0) {
                if (currentDiff < bestMatch.lengthDiff) {
                    bestMatch = { rowIndex: i + 1, score: currentScore, lengthDiff: currentDiff };
                }
            }
        }

        // --- SMART MERGE LOGIC ---
        const dateString = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
        
        const mergeCell = (oldVal, newVal) => {
            if (!newVal || newVal.trim() === '') return oldVal || '';
            if (!oldVal || oldVal.trim() === '') return newVal;
            if (oldVal.includes(newVal.trim())) return oldVal;
            return `${oldVal}\n\n[${dateString}]: ${newVal}`;
        };

        // --- GEOLOCATION INTEGRITY ENGINE ---
        let existingLat = null;
        let existingLng = null;

        if (bestMatch.rowIndex !== -1) {
            const existingRow = rows[bestMatch.rowIndex - 1] || [];
            existingLat = existingRow[7]; // Column H
            existingLng = existingRow[8]; // Column I
        }

        // Only Geocode if missing OR forceGeocode is true
        if (!existingLat || !existingLng || newPark.forceGeocode === true) {
            try {
                const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
                if (!googleMapsKey) {
                    console.warn(`GOOGLE_MAPS_API_KEY not configured; skipping geocoding for ${newPark.parkName}`);
                } else {
                    console.log(`Geocoding: ${newPark.parkName}...`);
                    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(newPark.parkName)}&key=${googleMapsKey}`;
                    const geoResponse = await axios.get(geoUrl);
                    if (geoResponse.data.results && geoResponse.data.results.length > 0) {
                        const location = geoResponse.data.results[0].geometry.location;
                        newPark.lat = location.lat;
                        newPark.lng = location.lng;
                        console.log(`Found Coords: ${newPark.lat}, ${newPark.lng}`);
                    }
                }
            } catch (e) {
                console.error("Geocoding failed:", e.message);
            }
        } else {
            newPark.lat = existingLat;
            newPark.lng = existingLng;
            console.log(`Locked: Using existing coordinates for ${newPark.parkName}`);
        }

        // 2. Perform the Update or Append
        if (bestMatch.rowIndex !== -1 && bestMatch.score >= 80) {
            const existingRow = rows[bestMatch.rowIndex - 1] || [];
            
            const existingParkId = cleanSheetCell(existingRow[15]); // Column P

            // Map the spreadsheet columns: H=7, I=8, J=9, K=10, L=11, M=12, N=13, O=14.
            // Column P is Park ID and must never be overwritten by refinery updates.
            const updateData = [
                newPark.lat || existingLat || '',  // H
                newPark.lng || existingLng || '',  // I
                mergeCell(existingRow[9], newPark.entranceFee), // J
                mergeCell(existingRow[10], newPark.swagLocation), // K
                mergeCell(existingRow[11], newPark.approvedTrails), // L
                mergeCell(existingRow[12], newPark.strictRules), // M
                mergeCell(existingRow[13], newPark.hazards), // N
                mergeCell(existingRow[14], newPark.extraSwag) // O
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: `'${sheetName}'!H${bestMatch.rowIndex}:O${bestMatch.rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [updateData] }
            });
            return { success: true, action: 'updated', row: bestMatch.rowIndex, confidence: bestMatch.score, parkIdPreserved: existingParkId || null };
        } else {
            // NEW GUARDRAIL: Only append if the frontend explicitly gave permission
            if (newPark.allowAppend !== true) {
                return { 
                    success: false, 
                    requiresConfirmation: true, 
                    message: `⚠️ New Site Detected: "${newPark.parkName}"` 
                };
            }

            const appendParkId = getCanonicalParkId(newPark.parkId) || randomUUID();
            const appendData = [
                newPark.parkName, "", "", "", "", "", "", 
                newPark.lat || '', 
                newPark.lng || '', 
                newPark.entranceFee, newPark.swagLocation, newPark.approvedTrails, 
                newPark.strictRules, newPark.hazards, newPark.extraSwag,
                appendParkId
            ];
            await sheets.spreadsheets.values.append({
                spreadsheetId: spreadsheetId,
                range: `'${sheetName}'!A:P`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: [appendData] }
            });
            return { success: true, action: 'appended', parkId: appendParkId };
        }
    } catch (error) {
        console.error("Spreadsheet Error:", error);
        throwHttpsError(error, 'Failed to sync to Sheets');
    }
});
