// admin.js
const firebaseConfig = {
    apiKey: "AIzaSyDcBn2YQCAFrAjN27gIM9lBiu0PZsComO4",
    authDomain: "barkrangermap-auth.firebaseapp.com",
    projectId: "barkrangermap-auth",
    storageBucket: "barkrangermap-auth.firebasestorage.app",
    messagingSenderId: "564465144962",
    appId: "1:564465144962:web:9e43dbc993b93a33d5d09b",
    measurementId: "G-V2QCN2MFBZ"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();
const functions = firebase.functions();

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const textInput = document.getElementById('text-input');
const processBtn = document.getElementById('process-btn');
const syncBtn = document.getElementById('sync-btn');
const discardBtn = document.getElementById('discard-btn');
const loadingOverlay = document.getElementById('loading-overlay');
const rawJsonOutput = document.getElementById('raw-json-output');

const searchInput = document.getElementById('park-name-search');
const searchResults = document.getElementById('search-results');
const parkIdHidden = document.getElementById('park-id-hidden');

const inputs = {
    entranceFee: document.getElementById('entrance-fee'),
    swagLocation: document.getElementById('swag-location'),
    approvedTrails: document.getElementById('approved-trails'),
    strictRules: document.getElementById('strict-rules'),
    hazards: document.getElementById('hazards'),
    extraSwag: document.getElementById('extra-swag'),
    dateInput: document.getElementById('date-input'),
    forceGeocode: document.getElementById('force-geocode')
};

let masterParks = [];
let fuse;

// 1. Auth Bouncer
auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.replace('../index.html');
        return;
    }

    const doc = await db.collection('users').doc(user.uid).get();
    if (!doc.exists || doc.data().isAdmin !== true) {
        window.location.replace('../index.html');
        return;
    }

    populateAdminTrailWarpGrid();
    initAdminSetPoints();
});

// 2. Fetch and Parse BARK Master List.csv
async function loadMasterCSV() {
    try {
        const response = await fetch('../BARK Master List.csv');
        const csvText = await response.text();
        
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                masterParks = results.data;
                const options = {
                    keys: ['name'],
                    threshold: 0.3
                };
                fuse = new Fuse(masterParks, options);
            }
        });
    } catch (error) {
        console.error("Error loading master list:", error);
    }
}
loadMasterCSV();

// 1. THE HOLDING PEN
let scheduledFiles = []; 
let parkQueue = [];

// 2. REMOVE INDIVIDUAL FILE
window.removeScheduledFile = function(index, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    // Remove exactly 1 item at the specific index clicked
    scheduledFiles.splice(index, 1); 
    renderDropZoneUI(); // Redraw the gallery
};

// 3. THE UI RENDERER (Builds the thumbnails and X buttons)
function renderDropZoneUI() {
    const dropZoneMain = document.getElementById('drop-zone');
    if (!dropZoneMain) return;

    if (scheduledFiles.length === 0) {
        dropZoneMain.innerHTML = '<p>Drop screenshot here</p><span style="font-size: 12px; color: #94a3b8;">or click to select</span>';
        return;
    }

    // Create a flexbox grid container for the thumbnails. 
    // It will scroll if you add more than fit in 140px of height.
    let html = `<div style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 10px; max-height: 140px; overflow-y: auto; padding: 5px; width: 100%;">`;

    // Loop through every file and create a thumbnail box
    scheduledFiles.forEach((file, index) => {
        // Create a temporary fast-loading URL for the image
        const objectURL = URL.createObjectURL(file);
        
        html += `
            <div style="position: relative; width: 65px; height: 65px; border: 1px solid #ccc; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <img src="${objectURL}" style="width: 100%; height: 100%; object-fit: cover; display: block;" title="${file.name}">
                
                <div onclick="removeScheduledFile(${index}, event)"
                     style="position: absolute; top: 2px; right: 2px; background: rgba(211, 47, 47, 0.9); color: white; border-radius: 50%; width: 18px; height: 18px; font-size: 14px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">
                    &times;
                </div>
            </div>
        `;
    });

    html += `</div>`;
    html += `<div style="margin-top: 12px; font-size: 0.95em; font-weight: bold; color: #2e7d32;">✅ ${scheduledFiles.length} Images Ready</div>`;

    dropZoneMain.innerHTML = html;
}

// 4. THE BATCH HANDLER
function handleFiles(files) {
    for (let i = 0; i < files.length; i++) {
        scheduledFiles.push(files[i]);
    }
    // Call the new renderer to show the thumbnails!
    renderDropZoneUI();
}

// 5. UI Interactions (Drag & Drop)
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
    }
});

fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
        handleFiles(fileInput.files);
    }
});

// Convert file to Base64
const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]); // get raw base64
    reader.onerror = error => reject(error);
});

// 5. THE PROCESSING ENGINE & LIVE TIMER
processBtn.addEventListener('click', async () => {
    const text = textInput.value.trim();
    const selectedEngine = document.getElementById('engineSelector').value;
    
    // Prevent clicking if nothing is scheduled
    if (scheduledFiles.length === 0 && !text) {
        alert("Please provide an image or pasted text.");
        return;
    }
    
    processBtn.disabled = true;
    const originalBtnText = processBtn.innerText;
    
    // Variables for our Live Timer
    let startTime = Date.now();
    let currentIndex = 0;
    let totalFiles = scheduledFiles.length;
    let timerInterval = null;

    loadingOverlay.style.display = 'flex';
    
    try {
        const extractParkData = functions.httpsCallable('extractParkData');
        
        // === AUTO-CHUNKING BATCH PROCESSOR ===
        if (totalFiles > 0) {
            
            // 1. Get the chunk size from the new UI dropdown
            const bundleSelectorValue = document.getElementById('bundleSelector') ? document.getElementById('bundleSelector').value : "3";
            const chunkSize = bundleSelectorValue === "all" ? totalFiles : parseInt(bundleSelectorValue, 10);

            // Start the stopwatch
            timerInterval = setInterval(() => {
                let elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
                processBtn.innerText = `Processing ${totalFiles} Images - ${elapsedSeconds}s...`;
            }, 1000);

            // 1. Convert ALL files to objects with names and data
            const imagesPayload = [];
            for (let i = 0; i < totalFiles; i++) {
                const base64 = await fileToBase64(scheduledFiles[i]);
                imagesPayload.push({
                    name: scheduledFiles[i].name, // e.g., "IMG_2281.PNG"
                    data: base64
                });
            }

            // 2. Loop through the images in chunks (e.g., 0-3, 3-6, 6-9)
            const totalBundles = Math.ceil(imagesPayload.length / chunkSize);
            
            for (let i = 0; i < imagesPayload.length; i += chunkSize) {
                const chunk = imagesPayload.slice(i, i + chunkSize);
                const currentBundleNum = Math.floor(i / chunkSize) + 1;

                // Update the overlay so you know exactly which chunk is uploading
                const loadingSubtitle = document.getElementById('loadingSubtitle');
                if (loadingSubtitle) {
                    const startImg = i + 1;
                    const endImg = Math.min(i + chunkSize, totalFiles);
                    loadingSubtitle.innerText = `Extracting Bundle ${currentBundleNum} of ${totalBundles} (Images ${startImg} to ${endImg})...`;
                }

                // Fire the request for this specific bundle
                const result = await extractParkData({ 
                    images: chunk, 
                    engineRoute: selectedEngine 
                });

                // Unpack the AI's response safely into your master queue
                const extractedData = result.data;
                if (Array.isArray(extractedData) && extractedData.length > 0) {
                    parkQueue.push(...extractedData); 
                } else if (!Array.isArray(extractedData) && extractedData && extractedData.parkName) {
                    parkQueue.push(extractedData);
                } else {
                    console.log(`AI Rejected Bundle ${currentBundleNum}: No valid parks found.`);
                }
            }
            
            // 4. Cleanup UI after the entire batch finishes
            scheduledFiles = [];
            renderDropZoneUI(); 
            const loadingSubtitle = document.getElementById('loadingSubtitle');
            if (loadingSubtitle) loadingSubtitle.innerText = "Gemini is reading the image/text.";
        } 
        
        // === RAW TEXT PROCESSING ===
        else if (text) {
            processBtn.innerText = "Processing Text...";
            const result = await extractParkData({ 
                text: text,
                engineRoute: selectedEngine 
            });
            const extractedData = result.data;

            if (Array.isArray(extractedData) && extractedData.length > 0) {
                parkQueue.push(...extractedData);
            } else if (extractedData && !Array.isArray(extractedData) && extractedData.parkName) {
                parkQueue.push(extractedData);
            }
            textInput.value = ""; 
        }

        // Update JSON preview for the top item
        if (parkQueue.length > 0) {
            rawJsonOutput.textContent = JSON.stringify(parkQueue[0], null, 2);
        }

        // === LOAD THE REVIEW UI ===
        updateDropdown();
        loadNextPark();

    } catch (error) {
        console.error("AI Processing Error:", error);
        alert("Failed to process data. Check the console.");
    } finally {
        // Kill the timer and reset the button
        if (timerInterval) clearInterval(timerInterval);
        processBtn.innerText = originalBtnText;
        processBtn.disabled = false;
        loadingOverlay.style.display = 'none';
        
        // Reset loading text for next time
        const loadingSubtitle = document.getElementById('loadingSubtitle');
        if (loadingSubtitle) {
            loadingSubtitle.innerText = "Gemini is reading the image/text.";
        }
    }
});

// 5. Queue Management Logic
function updateDropdown() {
    const dropdown = document.getElementById('park-queue-dropdown');
    const container = document.getElementById('queue-container');
    
    // Only show the dropdown if there is more than 1 park to review
    if (parkQueue.length > 1) {
        container.style.display = 'block';
        dropdown.innerHTML = ''; // Clear old options
        
        parkQueue.forEach((park, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `Reviewing: ${park.parkName || 'Unknown Park'} (${index + 1} of ${parkQueue.length})`;
            dropdown.appendChild(option);
        });

        // When you select a different park from the dropdown...
        dropdown.onchange = (e) => {
            // Move the selected park to the front of the line (index 0)
            const selectedIndex = parseInt(e.target.value);
            const selectedPark = parkQueue.splice(selectedIndex, 1)[0];
            parkQueue.unshift(selectedPark); 
            
            // Reload the UI
            updateDropdown();
            loadNextPark();
        };
    } else {
        container.style.display = 'none';
    }
}

function loadNextPark() {
    if (parkQueue.length > 0) {
        const currentPark = parkQueue[0];
        
        // --- NEW: Update the Source Display ---
        const sourceDisplay = document.getElementById('sourceImageDisplay');
        if (sourceDisplay) {
            sourceDisplay.style.display = "flex";
            sourceDisplay.innerText = `📄 Source: ${currentPark.sourceImage || "Unknown/Raw Text"}`;
        }

        // --- NEW: Set the date: Use AI found date, or default to Today ---
        const today = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        inputs.dateInput.value = currentPark.dateFound || today;

        // Auto-fill Verification UI
        if (currentPark.parkName) {
            searchInput.value = currentPark.parkName;
            performFuzzySearch(currentPark.parkName);
        }
        
        inputs.entranceFee.value = currentPark.entranceFee || '';
        inputs.swagLocation.value = currentPark.swagLocation || '';
        inputs.approvedTrails.value = currentPark.approvedTrails || '';
        inputs.strictRules.value = currentPark.strictRules || '';
        inputs.hazards.value = currentPark.hazards || '';
        inputs.extraSwag.value = currentPark.extraSwag || '';

        // Update button status
        syncBtn.textContent = `Sync to Map (${parkQueue.length} left)`;
        syncBtn.disabled = false;
    } else {
        // --- NEW: Hide the source display when the queue is empty ---
        const sourceDisplay = document.getElementById('sourceImageDisplay');
        if (sourceDisplay) sourceDisplay.style.display = "none";
        
        syncBtn.textContent = 'Sync to Map';
        syncBtn.disabled = false;
        alert("All parks processed and verified!");
        
        // Final Clean up
        fileInput.value = '';
        textInput.value = '';
        dropZone.innerHTML = '<p>Drop screenshot here</p><span style="font-size: 12px; color: #94a3b8;">or click to select</span>';
        searchInput.value = '';
        parkIdHidden.value = '';
        Object.values(inputs).forEach(input => input.value = '');
        rawJsonOutput.textContent = 'Waiting for data...';
        return;
    }
    syncBtn.textContent = `Sync to Map (${parkQueue.length} left)`;
    syncBtn.disabled = false;
}

// 6. Fuzzy Search UI
function performFuzzySearch(query) {
    if (!fuse || !query) {
        searchResults.style.display = 'none';
        return;
    }
    
    const results = fuse.search(query);
    searchResults.innerHTML = '';
    
    if (results.length > 0) {
        // Auto-select the top result logic
        parkIdHidden.value = results[0].item.lat_lng || '';
        
        results.slice(0, 5).forEach(res => {
            const div = document.createElement('div');
            div.className = 'search-dropdown-item';
            div.textContent = `${res.item.name} (${res.item.state})`;
            div.onclick = () => {
                searchInput.value = res.item.name;
                parkIdHidden.value = res.item.lat_lng || '';
                searchResults.style.display = 'none';
            };
            searchResults.appendChild(div);
        });
        searchResults.style.display = 'block';
    } else {
        searchResults.style.display = 'none';
    }
}

searchInput.addEventListener('input', (e) => {
    performFuzzySearch(e.target.value);
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-dropdown')) {
        searchResults.style.display = 'none';
    }
});

// 7. Sync Logic
syncBtn.addEventListener('click', async () => {
    if (parkQueue.length === 0) return;

    const originalText = syncBtn.textContent;
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';
    
    try {
        const parkToSync = {
            parkName: searchInput.value,
            entranceFee: inputs.entranceFee.value,
            swagLocation: inputs.swagLocation.value,
            approvedTrails: inputs.approvedTrails.value,
            strictRules: inputs.strictRules.value,
            hazards: inputs.hazards.value,
            extraSwag: inputs.extraSwag.value,
            dateUpdated: inputs.dateInput.value,
            forceGeocode: inputs.forceGeocode.checked, // Pass the override flag
            allowAppend: false // Default to false!
        };

        const syncToSpreadsheetCallable = firebase.functions().httpsCallable('syncToSpreadsheet');
        
        // 1. Try the initial sync
        let result = await syncToSpreadsheetCallable(parkToSync);

        // 2. Catch the Guardrail Warning
        if (result.data.requiresConfirmation) {
            const userWantsToAppend = confirm(
                `${result.data.message}\n\nThis location is not in your spreadsheet. Do you want to add it as a BRAND NEW row at the bottom?`
            );

            if (userWantsToAppend) {
                // User said yes! Flip the flag and try again.
                parkToSync.allowAppend = true;
                result = await syncToSpreadsheetCallable(parkToSync);
            } else {
                // User clicked cancel. Stop the sync and stay on this park.
                syncBtn.disabled = false;
                syncBtn.textContent = originalText;
                return; 
            }
        }
        
        console.log("Sync successful!", result.data);

        // Shift queue and load next
        parkQueue.shift();
        updateDropdown();
        loadNextPark();

    } catch (error) {
        console.error("Sync failed:", error);
        alert("Failed to sync to the database.");
    } finally {
        syncBtn.disabled = false;
        if (parkQueue.length > 0) {
            syncBtn.textContent = `Sync to Map (${parkQueue.length} left)`;
        } else {
            syncBtn.textContent = 'Sync to Map';
        }
    }
});

// 8. THE "TRASH IT" BUTTON
discardBtn.addEventListener('click', () => {
    if (parkQueue.length > 0) {
        // Remove the current park from the front of the line
        parkQueue.shift();

        // Load the next one (or show the empty state)
        loadNextPark();
        updateDropdown();
    }
});

// ====== DEV TOOLS ======
const ADMIN_TRAILS = [
    { id: 'half_dome', name: 'Half Dome', miles: 16.0, park: 'Yosemite National Park' },
    { id: 'angels_landing', name: 'Angels Landing', miles: 5.0, park: 'Zion National Park' },
    { id: 'zion_narrows', name: 'Zion Narrows', miles: 16.0, park: 'Zion National Park' },
    { id: 'cascade_pass', name: 'Cascade Pass / Sahale Arm', miles: 12.1, park: 'North Cascades National Park' },
    { id: 'highline_trail', name: 'Highline Trail', miles: 11.8, park: 'Glacier National Park' },
    { id: 'harding_icefield', name: 'Harding Icefield', miles: 8.2, park: 'Kenai Fjords National Park' },
    { id: 'old_rag', name: 'Old Rag Trail', miles: 9.3, park: 'Shenandoah National Park' },
    { id: 'emerald_lake', name: 'Emerald Lake', miles: 3.2, park: 'Rocky Mountain National Park' },
    { id: 'precipice_trail', name: 'Precipice Trail', miles: 2.1, park: 'Acadia National Park' },
    { id: 'skyline_loop', name: 'Skyline Trail Loop', miles: 5.5, park: 'Mount Rainier National Park' },
    { id: 'grand_canyon_rim2rim', name: 'Grand Canyon Rim to Rim', miles: 44.0, park: 'Grand Canyon National Park' }
];

function populateAdminTrailWarpGrid() {
    const grid = document.getElementById('admin-trail-warp-grid');
    if (!grid) return;
    grid.innerHTML = '';
    ADMIN_TRAILS.forEach(trail => {
        const btn = document.createElement('button');
        btn.className = 'dev-warp-btn';
        btn.textContent = trail.name;
        btn.onclick = async () => {
            const user = auth.currentUser;
            if (!user) { alert('Not signed in.'); return; }
            btn.disabled = true;
            btn.textContent = 'Warping...';
            try {
                const userRef = db.collection('users').doc(user.uid);
                const snap = await userRef.get();
                const existing = (snap.data() && snap.data().virtual_expedition && snap.data().virtual_expedition.history) || [];
                await userRef.set({
                    virtual_expedition: {
                        active_trail: trail.id,
                        trail_name: trail.name,
                        miles_logged: 0,
                        trail_total_miles: trail.miles,
                        history: existing
                    }
                }, { merge: true });
                btn.textContent = `✅ ${trail.name}`;
                setTimeout(() => { btn.textContent = trail.name; btn.disabled = false; }, 2000);
            } catch (err) {
                console.error('[admin] Trail warp failed:', err);
                btn.textContent = '❌ Failed';
                btn.disabled = false;
            }
        };
        grid.appendChild(btn);
    });
}

function initAdminSetPoints() {
    const setBtn = document.getElementById('admin-set-points-btn');
    const setInput = document.getElementById('admin-set-points-input');
    const setStatus = document.getElementById('admin-set-points-status');
    if (!setBtn || !setInput) return;

    setBtn.addEventListener('click', async () => {
        const user = auth.currentUser;
        if (!user) { alert('Not signed in.'); return; }
        const val = parseFloat(setInput.value);
        if (isNaN(val)) { alert('Enter a valid number.'); return; }
        setBtn.disabled = true;
        if (setStatus) setStatus.textContent = 'Saving...';
        try {
            await db.collection('users').doc(user.uid).set({ walkPoints: val }, { merge: true });
            if (setStatus) setStatus.textContent = `✅ Set to ${val}`;
        } catch (err) {
            console.error('[admin] Set points failed:', err);
            if (setStatus) setStatus.textContent = '❌ Failed';
        } finally {
            setBtn.disabled = false;
        }
    });
}
