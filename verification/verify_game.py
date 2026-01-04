from playwright.sync_api import Page, expect, sync_playwright
import time

def verify_game_load(page: Page):
    # 1. Go to the game
    page.goto("http://localhost:5173")

    # 2. Wait for canvas to be present
    canvas = page.locator("#pachinball-canvas")
    expect(canvas).to_be_visible()

    # 3. Wait a bit for BabylonJS to initialize and render
    time.sleep(5)

    # 4. Screenshot
    page.screenshot(path="verification/game_screenshot.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_game_load(page)
        finally:
            browser.close()
