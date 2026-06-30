#!/usr/bin/env python3
import os
import re
import json
import time
import datetime as dt
import urllib.request
import urllib.parse
import threading
import concurrent.futures
import tempfile
import requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from flask import Flask, jsonify, send_from_directory, request

# Import functions from our briefing script
from scripts.indico_briefing import fetch_event_materials, download_material, extract_text

app = Flask(__name__)

BASE_URL = "https://indico.cern.ch"
CACHE = {}
CACHE_TIME = 0
CACHE_TTL = 28800  # 8 hours
cache_lock = threading.Lock()

def get_indico_token():
    token = os.environ.get("INDICO_TOKEN")
    if token:
        return token
    # Try ~/.indico.sh
    sh_file = Path.home() / ".indico.sh"
    if sh_file.exists():
        try:
            content = sh_file.read_text(encoding="utf-8")
            m = re.search(r'export INDICO_TOKEN=["\']?([^"\'\s]+)["\']?', content)
            if m:
                return m.group(1)
        except Exception as e:
            print(f"Error reading ~/.indico.sh: {e}")
    return None

def get_cborg_api_key():
    token = os.environ.get("CBORG_API_KEY")
    if token:
        return token
    # Try ~/.API.sh
    sh_file = Path.home() / ".API.sh"
    if sh_file.exists():
        try:
            content = sh_file.read_text(encoding="utf-8")
            m = re.search(r'export CBORG_API_KEY=["\']?([^"\'\s]+)["\']?', content)
            if m:
                return m.group(1)
        except Exception as e:
            print(f"Error reading ~/.API.sh: {e}")
    return None

def request_bytes(url, token=None):
    headers = {"User-Agent": "cern-indico-briefing-agent/0.1"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()

def request_json(url, token=None):
    body = request_bytes(url, token)
    return json.loads(body.decode("utf-8"))

def people_names(entry):
    names = []
    for person in (entry.get("presenters") or entry.get("speakers") or []):
        if isinstance(person, dict):
            names.append(person.get("name") or person.get("fullName") or person.get("full_name") or "")
    return ", ".join(n for n in names if n)

def extract_zoom_link(html):
    # Search for Zoom meetings in hrefs
    m = re.search(r'href="(https?://[a-zA-Z0-9.-]*zoom\.us/[^"]+)"', html)
    if m:
        return m.group(1)
    # Search anywhere in text
    m = re.search(r'(https?://[a-zA-Z0-9.-]*zoom\.us/[^\s"\'<>]+)', html)
    if m:
        return m.group(1)
    return None

def fetch_event_details(event_id, token):
    # 1. Fetch Zoom link from event HTML page
    zoom_link = None
    try:
        html_data = request_bytes(f"{BASE_URL}/event/{event_id}/", token)
        zoom_link = extract_zoom_link(html_data.decode("utf-8", errors="replace"))
    except Exception as e:
        print(f"Error fetching HTML for event {event_id}: {e}")

    # 2. Fetch contributions list
    contributions = []
    try:
        contrib_url = f"{BASE_URL}/export/event/{event_id}.json?detail=contributions"
        contrib_data = request_json(contrib_url, token)
        results = contrib_data.get("results", [])
        if results:
            raw_contribs = results[0].get("contributions", [])
            # Sort contributions by time
            raw_contribs.sort(key=lambda x: (x.get("startDate", {}).get("date", ""), x.get("startDate", {}).get("time", "")))
            for c in raw_contribs:
                contributions.append({
                    "id": c.get("id"),
                    "title": c.get("title"),
                    "url": c.get("url"),
                    "presenters": people_names(c),
                    "time": c.get("startDate", {}).get("time", "")
                })
    except Exception as e:
        print(f"Error fetching contributions for event {event_id}: {e}")

    return zoom_link, contributions

def fetch_category_data(category, token):
    cat_id = category["id"]
    cat_name = category["name"]
    
    # Define date window (last 90 days, next 7 days)
    today = dt.date.today()
    date_from = (today - dt.timedelta(days=90)).isoformat()
    date_to = (today + dt.timedelta(days=7)).isoformat()
    
    params = urllib.parse.urlencode({"from": date_from, "to": date_to, "pretty": "yes"})
    url = f"{BASE_URL}/export/categ/{cat_id}.json?{params}"
    
    try:
        res = request_json(url, token)
        events = res.get("results", [])
    except Exception as e:
        raise RuntimeError(f"Failed to fetch category {cat_id}: {e}")

    # Apply require filter (with fallback to 'match')
    req_str = category.get("require", category.get("match", ""))
    if req_str:
        req_lower = req_str.lower()
        events = [
            e for e in events
            if req_lower in (e.get("title") or "").lower()
        ]

    # Apply exclude filter
    ex_str = category.get("exclude", "")
    if ex_str:
        ex_lower = ex_str.lower()
        events = [
            e for e in events
            if ex_lower not in (e.get("title") or "").lower()
        ]

    # Separate upcoming and past
    today_str = today.isoformat()
    upcoming = []
    past = []
    
    for event in events:
        start_date = event.get("startDate", {}).get("date", "")
        if start_date >= today_str:
            upcoming.append(event)
        else:
            past.append(event)
            
    # Sort chronologically
    upcoming.sort(key=lambda x: (x.get("startDate", {}).get("date", ""), x.get("startDate", {}).get("time", "")))
    past.sort(key=lambda x: (x.get("startDate", {}).get("date", ""), x.get("startDate", {}).get("time", "")))
    
    # Load last 3 (including upcoming in coming week)
    selected_events = list(upcoming)
    needed = 3 - len(selected_events)
    if needed > 0 and past:
        selected_events = past[-needed:] + selected_events

    # Build meeting objects
    meetings = []
    for event in selected_events:
        start_date = event.get("startDate", {}).get("date", "")
        meetings.append({
            "id": event.get("id"),
            "title": event.get("title"),
            "url": event.get("url"),
            "date": start_date,
            "time": event.get("startDate", {}).get("time", ""),
            "location": event.get("location", ""),
            "room": event.get("room", ""),
            "is_upcoming": start_date >= today_str
        })
        
    # Parallel fetch of details for the selected meetings
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(fetch_event_details, m["id"], token): m for m in meetings}
        for future in concurrent.futures.as_completed(futures):
            m = futures[future]
            try:
                zoom_link, contributions = future.result()
                m["zoom_link"] = zoom_link
                m["contributions"] = contributions
            except Exception as e:
                print(f"Error resolving details for meeting {m['id']}: {e}")
                m["zoom_link"] = None
                m["contributions"] = []

    return {
        "id": cat_id,
        "name": cat_name,
        "url": f"{BASE_URL}/category/{cat_id}/",
        "require": category.get("require", category.get("match", "")),
        "exclude": category.get("exclude", ""),
        "meetings": meetings
    }

def fetch_all_data():
    token = get_indico_token()
    
    # Load categories config
    config_path = Path("config/portal_categories.json")
    if not config_path.exists():
        return {"error": "Configuration file config/portal_categories.json not found."}
        
    try:
        categories = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as e:
        return {"error": f"Failed to parse config file: {e}"}

    results = []
    errors = []
    
    # Fetch categories in parallel
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(fetch_category_data, cat, token): cat for cat in categories}
        for future in concurrent.futures.as_completed(futures):
            cat = futures[future]
            try:
                cat_data = future.result()
                results.append(cat_data)
            except Exception as e:
                errors.append(str(e))
                print(f"Error fetching category {cat['id']}: {e}")
                
    # Sort results to match config order
    cat_order = {cat["id"]: idx for idx, cat in enumerate(categories)}
    results.sort(key=lambda x: cat_order.get(x["id"], 999))

    return {
        "categories": results,
        "errors": errors,
        "timestamp": dt.datetime.now().isoformat()
    }

@app.route("/api/meetings")
def api_meetings():
    global CACHE, CACHE_TIME
    with cache_lock:
        now = time.time()
        if not CACHE or (now - CACHE_TIME) > CACHE_TTL:
            try:
                data = fetch_all_data()
                if "error" not in data:
                    CACHE = data
                    CACHE_TIME = now
                else:
                    return jsonify(data), 500
            except Exception as e:
                return jsonify({"error": str(e)}), 500
        return jsonify(CACHE)

def resolve_category_name(category_id, token):
    # 1. Try to query category API and extract name from results
    try:
        url = f"{BASE_URL}/export/categ/{category_id}.json?limit=1"
        data = request_json(url, token)
        results = data.get("results", [])
        if results:
            name = results[0].get("category")
            if name:
                return name
    except Exception as e:
        print(f"Error querying API for category name {category_id}: {e}")

    # 2. Scrape from the HTML of the category page
    try:
        url_page = f"{BASE_URL}/category/{category_id}/"
        html = request_bytes(url_page, token).decode("utf-8", errors="replace")
        m = re.search(r'<title>(.*?)</title>', html, re.DOTALL | re.IGNORECASE)
        if m:
            title_text = m.group(1).strip()
            title_clean = title_text.replace("CERN Indico", "").replace("Indico", "").strip(" -|")
            if title_clean:
                return title_clean
    except Exception as e:
        print(f"Error scraping HTML for category name {category_id}: {e}")

    return f"Category {category_id}"

def save_categories(categories):
    config_path = Path("config/portal_categories.json")
    config_path.write_text(json.dumps(categories, indent=2), encoding="utf-8")

@app.route("/api/categories", methods=["POST"])
def api_add_category():
    global CACHE, CACHE_TIME
    try:
        token = get_indico_token()
        body = request.get_json() or {}
        input_val = body.get("url", "").strip()
        if not input_val:
            return jsonify({"error": "Indico URL or Category ID is required"}), 400
            
        # Parse category ID
        match = re.search(r'category/(\d+)', input_val)
        if match:
            cat_id = match.group(1)
        elif input_val.isdigit():
            cat_id = input_val
        else:
            return jsonify({"error": "Invalid Indico Category ID or URL format"}), 400

        # Load current categories
        config_path = Path("config/portal_categories.json")
        categories = []
        if config_path.exists():
            categories = json.loads(config_path.read_text(encoding="utf-8"))
            
        # Check if already exists
        if any(c.get("id") == cat_id for c in categories):
            return jsonify({"error": "Category is already added"}), 400
            
        # Resolve category name
        cat_name = resolve_category_name(cat_id, token)
        
        # Append and save
        categories.append({
            "id": cat_id,
            "name": cat_name
        })
        save_categories(categories)
        
        # Clear cache
        CACHE = {}
        CACHE_TIME = 0
        
        return jsonify({"success": True, "categories": categories})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/categories/<cat_id>", methods=["DELETE"])
def api_delete_category(cat_id):
    global CACHE, CACHE_TIME
    try:
        config_path = Path("config/portal_categories.json")
        categories = []
        if config_path.exists():
            categories = json.loads(config_path.read_text(encoding="utf-8"))
            
        new_categories = [c for c in categories if c.get("id") != cat_id]
        if len(new_categories) == len(categories):
            return jsonify({"error": "Category not found"}), 404
            
        save_categories(new_categories)
        
        # Clear cache
        CACHE = {}
        CACHE_TIME = 0
        
        return jsonify({"success": True, "categories": new_categories})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/categories/<cat_id>/filter", methods=["POST"])
def api_update_category_filters(cat_id):
    global CACHE, CACHE_TIME
    try:
        body = request.get_json() or {}
        req_str = body.get("require", "").strip()
        ex_str = body.get("exclude", "").strip()
        
        config_path = Path("config/portal_categories.json")
        if not config_path.exists():
            return jsonify({"error": "Config not found"}), 404
            
        categories = json.loads(config_path.read_text(encoding="utf-8"))
        
        found = False
        for c in categories:
            if c.get("id") == cat_id:
                c["require"] = req_str
                c["exclude"] = ex_str
                c["match"] = req_str
                found = True
                break
                
        if not found:
            return jsonify({"error": "Category not found"}), 404
            
        save_categories(categories)
        
        # Clear cache
        CACHE = {}
        CACHE_TIME = 0
        
        return jsonify({"success": True, "categories": categories})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/categories/reorder", methods=["POST"])
def api_reorder_categories():
    global CACHE, CACHE_TIME
    try:
        body = request.get_json() or {}
        new_order = body.get("order", [])
        if not new_order:
            return jsonify({"error": "New order list of IDs is required"}), 400
            
        config_path = Path("config/portal_categories.json")
        if not config_path.exists():
            return jsonify({"error": "Config not found"}), 404
            
        categories = json.loads(config_path.read_text(encoding="utf-8"))
        
        # Reorder based on ID list
        cat_map = {c.get("id"): c for c in categories}
        ordered_cats = []
        for cat_id in new_order:
            if cat_id in cat_map:
                ordered_cats.append(cat_map[cat_id])
                del cat_map[cat_id]
        ordered_cats.extend(cat_map.values())
        
        save_categories(ordered_cats)
        
        # Clear cache
        CACHE = {}
        CACHE_TIME = 0
        
        return jsonify({"success": True, "categories": ordered_cats})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/meetings/<meeting_id>/summary", methods=["POST"])
def api_meeting_summary(meeting_id):
    try:
        # 1. Check for cached summary
        summary_dir = Path("config/summaries")
        summary_path = summary_dir / f"summary_{meeting_id}.txt"
        if summary_path.exists():
            return jsonify({"summary": summary_path.read_text(encoding="utf-8")})
            
        # 2. Check for CBorg API key
        cborg_key = get_cborg_api_key()
        if not cborg_key:
            return jsonify({"error": "CBorg API key not configured. Please set export CBorg API key in ~/.API.sh"}), 500
            
        # 3. Retrieve Indico Token
        indico_token = get_indico_token()
        
        # 4. Fetch meeting materials
        materials = fetch_event_materials(meeting_id, indico_token)
        
        # 5. Keep only presentation slides (.pdf, .pptx)
        slide_materials = [m for m in materials if m.url.lower().endswith((".pdf", ".pptx"))]
        if not slide_materials:
            return jsonify({"error": "No presentation slides (PDF/PPTX) found for this meeting."}), 400
            
        # 6. Download slides and extract text
        extracted_texts = {}
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            for mat in slide_materials:
                try:
                    file_path = download_material(mat, tmp_path, indico_token)
                    text = extract_text(file_path)
                    if text.strip():
                        extracted_texts[mat.title] = text.strip()
                except Exception as e:
                    print(f"Error processing material {mat.title}: {e}")
                    
        if not extracted_texts:
            return jsonify({"error": "Failed to extract readable text from any presentation slides."}), 400
            
        # 7. Build LLM prompt
        prompt = "Below is the extracted text from the presentation slides of a meeting. Please generate a concise, structured executive summary highlighting key results, plots, decisions, and action items discussed in this meeting.\n\n"
        for title, text in extracted_texts.items():
            # Limit each presentation content to 30,000 characters
            prompt += f"### Document: {title}\n{text[:30000]}\n\n"
            
        payload = {
            "model": "lbl/cborg-chat",
            "messages": [
                {
                    "role": "system",
                    "content": "You are a professional assistant summarizing physics and research meeting slides."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        }
        
        headers = {
            "Authorization": f"Bearer {cborg_key}",
            "Content-Type": "application/json"
        }
        
        response = requests.post("https://api.cborg.lbl.gov/v1/chat/completions", json=payload, headers=headers, timeout=180)
        if response.status_code != 200:
            return jsonify({"error": f"CBorg API error (HTTP {response.status_code}): {response.text[:300]}"}), 500
            
        resp_data = response.json()
        summary = resp_data["choices"][0]["message"]["content"]
        
        # 8. Save cache
        summary_dir.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(summary, encoding="utf-8")
        
        return jsonify({"summary": summary})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/")
def index():
    return send_from_directory("static", "index.html")

@app.route("/static/<path:path>")
def serve_static(path):
    return send_from_directory("static", path)

if __name__ == "__main__":
    import sys
    if "--check" in sys.argv:
        print("Checking Indico configuration...")
        token = get_indico_token()
        if token:
            print("Token found: Yes (starts with", token[:6] + "...)")
        else:
            print("Token found: No")
        config_path = Path("config/portal_categories.json")
        if config_path.exists():
            print("Config categories file exists: Yes")
            print(config_path.read_text())
        else:
            print("Config categories file exists: No")
        sys.exit(0)
        
    app.run(host="0.0.0.0", port=5050, debug=True)
