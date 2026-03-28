import json
import csv

# 1. Open and read your JSON file
with open('data.json', 'r', encoding='utf-8') as json_file:
    data = json.load(json_file)

# 2. Define the columns for the spreadsheet
columns = ['name', 'state', 'swagType', 'lat', 'lng', 'info', 'website']

# 3. Create and write the CSV file
with open('data.csv', 'w', newline='', encoding='utf-8') as csv_file:
    writer = csv.DictWriter(csv_file, fieldnames=columns, extrasaction='ignore')
    writer.writeheader()
    for row in data:
        writer.writerow(row)

print("SUCCESS! Your data.csv file has been created.")