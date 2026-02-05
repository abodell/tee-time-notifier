import json
import os
from collections import Counter

def validate_courses(file_path):
    if not os.path.exists(file_path):
        print(f"Error: {file_path} not found.")
        return

    with open(file_path, 'r') as f:
        try:
            courses = json.load(f)
        except json.JSONDecodeError as e:
            print(f"Error: Failed to parse JSON: {e}")
            return

    print(f"--- Validating {file_path} ---")
    print(f"Total entries: {len(courses)}")

    # 1. Check for duplicates (composite key: course_id + schedule_id)
    keys = []
    for c in courses:
        cid = c.get("configs", {}).get("course_id")
        sid = c.get("configs", {}).get("schedule_id")
        keys.append(f"{cid}:{sid}")

    duplicates = [item for item, count in Counter(keys).items() if count > 1]
    
    if duplicates:
        print(f"\n[FAIL] Found {len(duplicates)} duplicate entries (course_id:schedule_id):")
        for d in duplicates:
            print(f"  - {d}")
    else:
        print("\n[PASS] No duplicate entries found.")

    # 2. Check for missing critical fields
    missing_fields = []
    for i, c in enumerate(courses):
        required = ["name", "address", "city", "state", "configs"]
        for field in required:
            if not c.get(field):
                missing_fields.append((i, field, c.get("name", "Unknown")))
        
        # Nested configs
        config_required = ["course_id", "schedule_id", "booking_class", "timezone"]
        for cf in config_required:
            if not c.get("configs", {}).get(cf):
                missing_fields.append((i, f"configs.{cf}", c.get("name", "Unknown")))

    if missing_fields:
        print(f"\n[FAIL] Found {len(missing_fields)} missing fields:")
        for idx, field, name in missing_fields[:10]:
            print(f"  - Entry {idx} ({name}): missing '{field}'")
        if len(missing_fields) > 10:
            print(f"  - ... and {len(missing_fields) - 10} more")
    else:
        print("[PASS] All required fields are present.")

    # 3. Identify multi-course facilities
    course_id_counts = Counter([c.get("configs", {}).get("course_id") for c in courses])
    multi_courses = {cid: count for cid, count in course_id_counts.items() if count > 1}

    if multi_courses:
        print(f"\n[INFO] Found {len(multi_courses)} multi-course facilities:")
        for cid, count in list(multi_courses.items())[:10]:
            facility_name = next(c["name"] for c in courses if c["configs"]["course_id"] == cid).split(" - ")[0]
            print(f"  - {facility_name} (ID: {cid}): {count} entries")
        if len(multi_courses) > 10:
            print(f"  - ... and {len(multi_courses) - 10} more")
    else:
        print("\n[INFO] No multi-course facilities found.")

    print("\n--- Validation Complete ---")

if __name__ == "__main__":
    validate_courses("backend/seeds/courses.json")
