import csv
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MASTER_LIST = REPO_ROOT / '01-code' / 'app' / 'data' / 'BARK Master List.csv'
DATA_CSV = REPO_ROOT / '02-data' / 'data' / 'data.csv'

def main():
    # 1. Load the original full descriptions
    master_info = {}
    with open(MASTER_LIST, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        next(reader) # skip headers
        for row in reader:
            if len(row) >= 5:
                loc = row[0].strip()
                # Preserve the newlines!
                info = row[4].strip()
                master_info[loc] = info

    # 2. Update the existing data.csv with the full descriptions
    updated_rows = []
    with open(DATA_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            loc = row['name'].strip()
            if loc in master_info:
                row['info'] = master_info[loc]
            updated_rows.append(row)

    # 3. Write back the fixed data
    with open(DATA_CSV, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(updated_rows)

    print("SUCCESS: data.csv has been repaired with FULL descriptions and newlines preserved!")

if __name__ == '__main__':
    main()
