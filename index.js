const functions = require('firebase-functions/v1');
const admin = require("firebase-admin");
const axios = require("axios");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');

// Initialize Firebase Admin SDK
admin.initializeApp();

// ============================================================================
// 1. LEGACY MAP FUNCTIONS (ROUTING & LEADERBOARD)
// ============================================================================

exports.getPremiumRoute = functions.https.onCall(async (requestOrData, context) => {
    const payload = requestOrData.data ? requestOrData.data : requestOrData;
    const coordinates = payload.coordinates;

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new functions.https.HttpsError("invalid-argument", "Payload mismatch!");
    }

    const url = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";
    const hardcodedApiKey = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImQ0YTM5ZTM2NTQ2NDRhNThhOWUxNDNjMmQyYTYzZDRkIiwiaCI6Im11cm11cjY0In0=";

    try {
        const response = await axios.post(url, { coordinates: coordinates }, {
            headers: {
                "Authorization": hardcodedApiKey,
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
    .runWith({ secrets: ["GEMINI_API_KEY"], memory: '1GB' })
    .https.onCall(async (data, context) => {
        try {
            // Read the route from the frontend, default to free-3
            const engineRoute = data.engineRoute || "free-3";
            
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
                // Account 2 - Unlimited Pay-As-You-Go Key
                targetApiKey = "AIzaSyD57GI_72OIRhsz3Ccnl7r_J4znhWsxMLM"; 
                targetModelName = "gemini-3-flash-preview";
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
            if (data.images && data.images.length > 0) {
                data.images.forEach((imgObj) => {
                    const cleanBase64 = imgObj.data.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
                    
                    // We label the part so the AI knows which name belongs to which image
                    parts.push(`--- START OF IMAGE: ${imgObj.name} ---`);
                    parts.push({ inlineData: { data: cleanBase64, mimeType: "image/jpeg" } });
                });
                // Add the text prompt at the very end of the pile
                parts.push(prompt);
            } 
            // 2. Fallback for a single image
            else if (data.image) {
                const base64String = data.image.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
                parts = [{ inlineData: { data: base64String, mimeType: "image/jpeg" } }, prompt];
            } 
            // 3. Fallback for raw text
            else {
                parts = [data.text, prompt];
            }

            const result = await model.generateContent(parts);
            const responseText = result.response.text();
            const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const aiData = JSON.parse(cleanedText);
            console.log("AI RAW OUTPUT:", JSON.stringify(aiData, null, 2));
            return aiData;
        } catch (error) {
            console.error("AI Error:", error);
            throw new functions.https.HttpsError('internal', error.message);
        }
    });

// ============================================================================
// 2. SPREADSHEET BRIDGE: THE NEW SITE GUARDRAIL
// ============================================================================
exports.syncToSpreadsheet = functions.https.onCall(async (data, context) => {
    try {
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        const sheets = google.sheets({ version: 'v4', auth });

        const spreadsheetId = '1fnlZfRbfQIy-o2Df6FgEdTMw9OWTR3-JX011s-7oWlE'; 
        const sheetName = 'National B.A.R.K Ranger'; 
        const newPark = data; 

        // 1. Fetch the ENTIRE row (A through O) so we can see existing data
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: `'${sheetName}'!A:O`, 
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
                console.log(`Geocoding: ${newPark.parkName}...`);
                const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(newPark.parkName)}&key=${process.env.GOOGLE_MAPS_API_KEY || "AIzaSy..."}`; // Placeholder for key safety
                // Using axios since it's already imported
                const geoResponse = await axios.get(geoUrl);
                if (geoResponse.data.results && geoResponse.data.results.length > 0) {
                    const location = geoResponse.data.results[0].geometry.location;
                    newPark.lat = location.lat;
                    newPark.lng = location.lng;
                    console.log(`Found Coords: ${newPark.lat}, ${newPark.lng}`);
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
            
            // Map the spreadsheet columns: H=7, I=8, J=9, K=10, L=11, M=12, N=13, O=14, P=15
            const updateData = [
                newPark.lat || existingLat || '',  // H
                newPark.lng || existingLng || '',  // I
                mergeCell(existingRow[9], newPark.entranceFee), // J
                mergeCell(existingRow[10], newPark.swagLocation), // K
                mergeCell(existingRow[11], newPark.approvedTrails), // L
                mergeCell(existingRow[12], newPark.strictRules), // M
                mergeCell(existingRow[13], newPark.hazards), // N
                mergeCell(existingRow[14], newPark.extraSwag), // O
                newPark.dateUpdated // P
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: `'${sheetName}'!H${bestMatch.rowIndex}:P${bestMatch.rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [updateData] }
            });
            return { success: true, action: 'updated', row: bestMatch.rowIndex, confidence: bestMatch.score };
        } else {
            // NEW GUARDRAIL: Only append if the frontend explicitly gave permission
            if (newPark.allowAppend !== true) {
                return { 
                    success: false, 
                    requiresConfirmation: true, 
                    message: `⚠️ New Site Detected: "${newPark.parkName}"` 
                };
            }

            const appendData = [
                newPark.parkName, "", "", "", "", "", "", 
                newPark.lat || '', 
                newPark.lng || '', 
                newPark.entranceFee, newPark.swagLocation, newPark.approvedTrails, 
                newPark.strictRules, newPark.hazards, newPark.extraSwag,
                newPark.dateUpdated // <--- Add the timestamp (Col P)
            ];
            await sheets.spreadsheets.values.append({
                spreadsheetId: spreadsheetId,
                range: `'${sheetName}'!A:P`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: [appendData] }
            });
            return { success: true, action: 'appended' };
        }
    } catch (error) {
        console.error("Spreadsheet Error:", error);
        throw new functions.https.HttpsError('internal', 'Failed to sync to Sheets');
    }
});