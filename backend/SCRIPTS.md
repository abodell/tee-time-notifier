# Backend Scripts Documentation

This guide explains how to use the scraping and seeding scripts for the Tee Time Notifier backend.

## Prerequisites

Always use the project's virtual environment to run scripts to ensure all dependencies are available.

```bash
# Path to the python interpreter in the venv
backend/venv/bin/python3
```

---

## 1. Scraping ForeUp Courses

Use `scrape_foreup.py` to fetch course data from ForeUp.

### Parameters:
- `--start`: The beginning ForeUp Course ID.
- `--end`: The ending ForeUp Course ID.
- `--out`: Path to the output JSON file (default: `backend/seeds/courses.json`).

### Usage Examples:

**Scrape a range of IDs:**
```bash
backend/venv/bin/python3 backend/scripts/scrape_foreup.py --start 20000 --end 21000 --out backend/seeds/courses.json
```

**Scrape a single ID:**
```bash
backend/venv/bin/python3 backend/scripts/scrape_foreup.py --start 20662 --end 20662 --out backend/seeds/courses.json
```

---

## 2. Seeding Courses to Supabase

Use `seed_courses.py` to push scraped JSON data to your Supabase `courses` and `provider_configs` tables.

### Parameters:
- `file`: Path to the JSON file to seed (optional, defaults to `backend/seeds/courses.json`).
- `--id`: Filter to only seed a specific provider course ID from the file.

### Usage Examples:

**Seed all courses from the main file:**
```bash
backend/venv/bin/python3 backend/scripts/seed_courses.py
```

**Seed all courses from a specific file:**
```bash
backend/venv/bin/python3 backend/scripts/seed_courses.py backend/seeds/my_courses.json
```

**Seed a single Course ID:**
```bash
backend/venv/bin/python3 backend/scripts/seed_courses.py backend/seeds/courses.json --id 20662
```

python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

python3 backend/scripts/scrape_chronogolf.py --start 13000 --end 15000 --concurrency 25 --out backend/seeds/chronogolf_large.json