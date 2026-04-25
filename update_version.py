import json
import re

# File paths
VERSION_FILE = 'version.json'
INDEX_FILE = 'index.html'
APP_FILE = 'app.js'

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
    html = re.sub(r'app\.js\?v=\d+', f'app.js?v={new_version}', html)
    
    with open(INDEX_FILE, 'w') as f:
        f.write(html)
        
    print(f"Updated index.html to use version {new_version}")

    # Update app.js
    with open(APP_FILE, 'r') as f:
        app_js = f.read()
        
    app_js = re.sub(r'const APP_VERSION = [\d\.]+;', f'const APP_VERSION = {new_version};', app_js)
    
    with open(APP_FILE, 'w') as f:
        f.write(app_js)
        
    print(f"Updated app.js constant to version {new_version}")

if __name__ == '__main__':
    update_version()
