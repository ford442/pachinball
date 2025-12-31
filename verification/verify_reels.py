from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Listen for console logs
        msgs = []
        page.on("console", lambda msg: msgs.append(msg.text))

        try:
            page.goto("http://localhost:5173/")

            # Click start button if it exists
            if page.locator("#start-btn").is_visible():
                page.click("#start-btn")

            # Wait a bit for initialization
            page.wait_for_timeout(5000)

            # Check logs
            print("Console logs:")
            for m in msgs:
                print(m)

            # Take screenshot
            page.screenshot(path="verification/reels.png")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
