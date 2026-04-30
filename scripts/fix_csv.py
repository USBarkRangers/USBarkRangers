import csv

def main():
    # 1. Load the original full descriptions
    master_info = {}
    with open('BARK Master List.csv', 'r', encoding='utf-8') as f:
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
    with open('data.csv', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            loc = row['name'].strip()
            if loc in master_info:
                row['info'] = master_info[loc]
            updated_rows.append(row)

    # 3. Write back the fixed data
    with open('data.csv', 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(updated_rows)

    print("SUCCESS: data.csv has been repaired with FULL descriptions and newlines preserved!")

if __name__ == '__main__':
    main()
