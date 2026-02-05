import asyncio
import sys
import os

sys.path.append(os.getcwd())

from app.services.foreup_service import run_foreup_scan

async def main():
    print("Testing run_foreup_scan()...")
    await run_foreup_scan()
    print("Done.")

if __name__ == "__main__":
    asyncio.run(main())
