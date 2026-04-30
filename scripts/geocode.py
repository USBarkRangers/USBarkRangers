import csv
import json
import time
import urllib.request
import urllib.parse
import re
import sys

input_file = '/Users/carterswarm/BarkRangerMap/BARK Master List.csv'
output_file = '/Users/carterswarm/BarkRangerMap/data.json'

def get_swag_type(info):
    info_lower = info.lower()
    if 'tag' in info_lower:
        return 'Tag'
    elif 'bandana' in info_lower or 'vest' in info_lower:
        return 'Bandana'
    elif 'certificate' in info_lower or 'pledge' in info_lower:
        return 'Certificate'
    return 'Other'

def geocode(location, state):
    # Step 1: Primary Search
    q1 = f"{location}, {state}, USA"
    
    # Step 2: Scrubbed Search
    # Remove 'Visitor Center', 'VC', 'Nature Center'
    clean_loc = re.sub(r'(?i)\b(visitor center|vc|nature center)\b', '', location)
    # Remove street addresses (e.g. 'Lewis Center Road', 'Lane', etc.)
    clean_loc = re.sub(r'(?i)\b\d*\s*[a-z0-9\s]+ (road|rd|street|st|avenue|ave|parkway|pkwy|highway|hwy|lane|ln|knob rd|blue rdg pkwy)\b', '', clean_loc)
    clean_loc = ' '.join(clean_loc.split()).strip()
    q2 = f"{clean_loc}, {state}, USA"
    
    # Step 3: Broad Search (First 3 words + State)
    words = location.split()
    q3 = f"{' '.join(words[:3])}, {state}, USA"
    
    # Step 4: Tiny Search (Location only)
    q4 = location
    
    # Step 6: THE SUPER-SCRUBBER (Final Fallback)
    first_two = ' '.join(words[:2])
    super_clean = re.sub(r'(?i)\b(national|state|park|monument|forest|refuge)\b', '', first_two)
    super_clean = ' '.join(super_clean.split()).strip()
    q6 = f"{super_clean}, {state}, USA"
    
    queries = [
        (q1, "STEP 1"),
        (q2, "STEP 2"),
        (q3, "STEP 3"),
        (q4, "STEP 4"),
        (q6, "STEP 6 (SUPER-SCRUBBER)")
    ]
    
    headers = {'User-Agent': 'BarkRangerExplorer_Carter'}
    
    for q, step_name in queries:
        if not q.strip() or len(q) < 3: continue
        url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(q)}&format=json&limit=1"
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req) as response:
                result = json.loads(response.read().decode('utf-8'))
                time.sleep(2.0) # Increased to 2.0s to be safer against 429s
                if result:
                    print(f"    SUCCESS ON {step_name}: {q}", flush=True)
                    return float(result[0]['lat']), float(result[0]['lon'])
        except Exception as e:
            # Check for 429 and back off even more
            if hasattr(e, 'code') and e.code == 429:
                print("    RATE LIMITED (429). Sleeping 10s...", flush=True)
                time.sleep(10)
            else:
                time.sleep(2.0)
            pass
        
    return None, None

def main():
    data = []
    # Load existing data if any to avoid re-geocoding row 1-9
    # But for a clean start from 10 as requested:
    with open(input_file, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        headers = next(reader)
        rows = list(reader)
        total = len(rows)
        
        for i, row in enumerate(rows):
            # START FROM ROW 10 (index 9)
            if i < 9:
                continue
            
            if len(row) < 6:
                continue
            location = row[0].strip()
            state = row[1].strip()
            info = row[4].strip().replace('\n', ' ')
            website = row[5].strip()
            
            if not location:
                continue
                
            swag = get_swag_type(info)
            lat, lng = geocode(location, state)
            
            if lat is not None and lng is not None:
                item = {
                    "name": location,
                    "state": state,
                    "info": info[:300] + "..." if len(info) > 300 else info,
                    "website": website,
                    "swagType": swag,
                    "lat": lat,
                    "lng": lng
                }
                data.append(item)
                print(f"[{i+1}/{total}] SUCCESS: {location} -> ({lat}, {lng}) | Swag: {swag}", flush=True)
            else:
                print(f"[{i+1}/{total}] FAILED: {location}", flush=True)
                
            # Incremental save to not lose data
            with open(output_file, 'w', encoding='utf-8') as out:
                json.dump(data, out, indent=2)
                
    print("Geocoding complete!", flush=True)

if __name__ == '__main__':
    main()
