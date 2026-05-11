/**
 * google-sheets-autopilot.js
 * 
 * DESCRIPTION:
 * This script runs inside the Google Sheets Apps Script environment.
 * It provides "Auto-Pilot" geocoding for manual entries.
 * 
 * INSTALLATION:
 * 1. Open your Google Sheet.
 * 2. Go to Extensions > Apps Script.
 * 3. Delete any boilerplate code and paste this entire script.
 * 4. Click the Save icon (floppy disk) and name it "Data Refinery Auto-Pilot".
 * 5. You're done! It will now watch for changes in Column A.
 */

/**
 * This runs automatically every time a cell is edited in the spreadsheet.
 */
function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  const range = e.range;
  
  // 1. SETTINGS: Only watch the "National B.A.R.K. Ranger" sheet
  if (sheet.getName() !== "National B.A.R.K. Ranger") return;

  const row = range.getRow();
  const col = range.getColumn();

  // 2. TRIGGER: Only run if Column A (1) is edited and it's not the header
  if (col === 1 && row > 1) {
    const parkName = range.getValue();
    
    // Check if Columns H (8) and I (9) are already filled
    const existingLat = sheet.getRange(row, 8).getValue();
    const existingLng = sheet.getRange(row, 9).getValue();

    // 3. GUARDRAIL: Only geocode if the name is present and coords are missing
    if (parkName && (!existingLat || !existingLng)) {
      try {
        const results = Maps.newGeocoder().geocode(parkName);
        if (results.status === "OK") {
          const loc = results.results[0].geometry.location;
          
          // Fill in the coordinates automatically
          sheet.getRange(row, 8).setValue(loc.lat);
          sheet.getRange(row, 9).setValue(loc.lng);
          
          // Optional: Change the cell color briefly so the admin sees it worked
          range.setBackground('#e8f5e9');
          Utilities.sleep(500);
          range.setBackground(null);
        }
      } catch (err) {
        console.error("Geocoding failed for: " + parkName);
      }
    }
  }
}
