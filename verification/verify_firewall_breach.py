import time
from playwright.sync_api import sync_playwright

def test_firewall_breach(page):
    print("Navigating to game...")
    page.goto("http://localhost:3000")

    # Wait for start button
    print("Waiting for start button...")
    page.wait_for_selector("#start-btn")
    page.click("#start-btn")

    # Wait for game to initialize
    time.sleep(2)

    # Helper to toggle adventure mode
    def toggle_adventure():
        page.keyboard.press("h")
        time.sleep(0.5)

    print("Cycling through adventure tracks...")

    tracks = [
        "NEON HELIX",
        "CYBER CORE",
        "QUANTUM GRID",
        "SINGULARITY WELL",
        "GLITCH SPIRE",
        "RETRO WAVE HILLS",
        "CHRONO CORE",
        "HYPER DRIFT",
        "PACHINKO SPIRE",
        "ORBITAL JUNKYARD",
        "FIREWALL BREACH"
    ]

    score_el = page.locator("#score")

    for i, track_name in enumerate(tracks):
        print(f"Attempting to start track {i+1}: {track_name}")
        toggle_adventure() # Start

        # Wait for update
        time.sleep(1.0)

        # Check text
        # We handle case sensitivity just in case, but code uses uppercase enum keys
        # The game code: track.replace('_', ' ')
        current_text = score_el.inner_text()
        print(f"HUD Text: {current_text}")

        if "FIREWALL BREACH" in current_text:
            print("Target track reached!")
            # Wait for camera to move and track to build
            time.sleep(5)
            page.screenshot(path="verification/verification.png")
            return

        toggle_adventure() # End (Stop current track)
        time.sleep(1.0)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        # Set viewport to something reasonable for a screenshot
        page.set_viewport_size({"width": 1280, "height": 720})
        try:
            test_firewall_breach(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="/home/jules/verification/error.png")
        finally:
            browser.close()
