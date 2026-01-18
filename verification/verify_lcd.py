from playwright.sync_api import sync_playwright
import time
import os

def verify_lcd():
    print("Starting Playwright verification...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_viewport_size({"width": 1280, "height": 720})

        print("Navigating to game...")
        page.goto("http://localhost:5173")

        # Wait for loading (physics engine takes time)
        print("Waiting for load...")
        time.sleep(5)

        print("Clicking Start Game...")
        try:
            # Wait for button to be visible
            page.wait_for_selector("#start-btn", state="visible", timeout=10000)
            page.click("#start-btn", force=True)
            print("Clicked Start Game.")
        except Exception as e:
            print(f"Error clicking start: {e}")

        # Wait for menu to fade out
        time.sleep(3)

        # Ensure directory exists
        os.makedirs("verification", exist_ok=True)

        output_path = "verification/lcd_verification_v3.png"
        print(f"Taking screenshot to {output_path}...")
        page.screenshot(path=output_path)

        browser.close()
        print("Verification complete.")

if __name__ == "__main__":
    verify_lcd()
