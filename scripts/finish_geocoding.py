import pandas as pd
from geopy.geocoders import Nominatim
import time
import os

# Initialize Geocoder
geolocator = Nominatim(user_agent="BarkRanger_Final_Build")

def get_coords(name, state):
    """6-Step Super-Scrubber Logic"""
    steps = [
        f"{name}, {state}, USA", # Step 1: Full
        f"{name}, USA",          # Step 2: Broad
        " ".join(str(name).split()[:3]) + f", {state}, USA", # Step 3: First 3 words
        " ".join(str(name).split()[:2]) + f", {state}, USA", # Step 4: First 2 words
        str(name).split()[0] + f", {state}, USA",            # Step 5: First word + State
        f"{state}, USA"          # Step 6: Center of State (Last Resort)
    ]
    
    for i, query in enumerate(steps, 1):
        try:
            # Clean common 'noise' words for fallback steps
            if i > 2:
                query = query.replace("Visitor Center", "").replace("VC", "").replace("Nature Center", "")
            
            location = geolocator.geocode(query, timeout=10)
            if location:
                print(f"  [STEP {i} SUCCESS] -> {query}")
                return location.latitude, location.longitude
        except:
            continue
        time.sleep(1.2) # Safety delay for API limits
    
    return None, None

def main():
    input_file = 'BARK Master List.csv'
    output_file = 'BARK_Final_Map_Data.csv'
    
    if not os.path.exists(input_file):
        print(f"Error: {input_file} not found!")
        return

    df = pd.read_csv(input_file)
    
    # Create empty columns if they don't exist
    if 'Lat' not in df.columns:
        df['Lat'] = None
    if 'Lng' not in df.columns:
        df['Lng'] = None

    print(f"Starting geocoding for {len(df)} rows. This will take ~10 minutes.")

    for index, row in df.iterrows():
        # Skip if already geocoded
        if pd.notnull(row['Lat']) and pd.notnull(row['Lng']):
            continue
            
        print(f"[{index+1}/{len(df)}] Processing: {row['Location']}...")
        lat, lng = get_coords(row['Location'], row['State'])
        
        df.at[index, 'Lat'] = lat
        df.at[index, 'Lng'] = lng
        
        # Save progress every 10 rows in case of a crash
        if index % 10 == 0:
            df.to_csv(output_file, index=False)

    df.to_csv(output_file, index=False)
    print(f"\nDONE! Final file saved as: {output_file}")

if __name__ == "__main__":
    main()