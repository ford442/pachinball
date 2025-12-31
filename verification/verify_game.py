from playwright.sync_api import sync_playwright
import time

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1920, "height": 1080})
    page = context.new_page()
    try:
        print("Navigating...")
        page.goto("http://localhost:5173")
        print("Waiting for start button...")
        page.wait_for_selector("#start-btn", state="visible")
        print("Clicking start...")
        page.click("#start-btn")
        print("Waiting for game...")
        time.sleep(5) # Wait for camera and scene
        print("Taking screenshot...")
        page.screenshot(path="verification/slot_active.png")
        print("Done.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
