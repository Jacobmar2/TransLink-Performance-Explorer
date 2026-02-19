import json
import requests

# Test the API endpoint
url = "http://localhost:5000/api/daily-boardings-data"
response = requests.get(url)
data = response.json()

print("API Response Status:", response.status_code)
print("Number of lines in data:", len(data))
print("\nSample lines available:")
for i, line_name in enumerate(list(data.keys())[:5]):
    print(f"  Line {line_name}: {data[line_name]}")

# Check for specific lines
test_lines = ['2', '3', '4']
print("\nChecking test lines:")
for line in test_lines:
    if line in data:
        print(f"  Line {line}: Found - {data[line]}")
    else:
        print(f"  Line {line}: NOT FOUND")
