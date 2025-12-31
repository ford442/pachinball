import time
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://localhost:5173")

    # Wait for the game to load (give it some time for assets and physics)
    time.sleep(5)

    # Take a screenshot of the initial state (IDLE)
    page.screenshot(path="verification/slot_idle.png")

    # We can't easily simulate physics/gameplay in a headless script to hit the catcher
    # but we can check if the game loaded without errors.

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
