import json
import re
from pathlib import Path

# File paths
REPO_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = REPO_ROOT / '01-code' / 'app'
VERSION_FILE = APP_ROOT / 'version.json'
INDEX_FILE = APP_ROOT / 'index.html'
BARK_STATE_FILE = APP_ROOT / 'modules' / 'barkState.js'

def update_version():
    with open(VERSION_FILE, 'r') as f:
        data = json.load(f)
    
    current_version = data.get('version', 1)
    new_version = current_version + 1
    
    # Write back version.json
    data['version'] = new_version
    with open(VERSION_FILE, 'w') as f:
        json.dump(data, f, indent=2)
        
    print(f"Updated version.json to version {new_version}")
    
    # Update index.html
    with open(INDEX_FILE, 'r') as f:
        html = f.read()
    
    html = re.sub(r'styles\.css\?v=\d+', f'styles.css?v={new_version}', html)
    html = re.sub(r'core/app\.js\?v=\d+', f'core/app.js?v={new_version}', html)
    
    with open(INDEX_FILE, 'w') as f:
        f.write(html)
        
    print(f"Updated index.html to use version {new_version}")

    # Update the initial app version fallback used before version.json loads.
    with open(BARK_STATE_FILE, 'r') as f:
        app_js = f.read()
        
    app_js = re.sub(
        r"localStorage\.getItem\('bark_seen_version'\) \|\| '\d+'",
        f"localStorage.getItem('bark_seen_version') || '{new_version}'",
        app_js
    )
    
    with open(BARK_STATE_FILE, 'w') as f:
        f.write(app_js)
        
    print(f"Updated barkState.js fallback to version {new_version}")

if __name__ == '__main__':
    update_version()
