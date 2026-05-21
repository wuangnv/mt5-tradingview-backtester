import urllib.request
import re

url = "https://unpkg.com/lightweight-charts-drawing/dist/lightweight-charts-drawing.umd.js"
print("Downloading UMD file...")
try:
    with urllib.request.urlopen(url) as response:
        js = response.read().decode('utf-8')
    print("Downloaded successfully!")
    
    # Search for "requiredAnchors" in the entire JS file
    matches = re.finditer(r'(\w+):\s*\{\s*type:\s*["\'](long-position|short-position)["\'][^}]*\}', js)
    # Let's search for "new un(" or "factory" and list them
    # Let's look for "requiredAnchors" and print their contexts
    for m in re.finditer(r'requiredAnchors:\s*\d+', js):
        start = max(0, m.start() - 150)
        end = min(len(js), m.end() + 150)
        print("Required Anchors Context:")
        print(js[start:end].replace('\n', ' '))
        print("-" * 50)
        
except Exception as e:
    print("Error:", e)
