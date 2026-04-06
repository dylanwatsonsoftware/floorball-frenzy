from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        iphone_12_pro = p.devices['iPhone 12 Pro']
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            **iphone_12_pro,
        )
        page = context.new_page()

        page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))

        page.goto("http://localhost:5174/")
        page.wait_for_timeout(3000)

        # Log Phaser game size
        phaser_size = page.evaluate("""() => {
            const game = window.Phaser.GAMES[0];
            return {
                width: game.scale.width,
                height: game.scale.height,
                baseWidth: game.config.width,
                baseHeight: game.config.height,
            }
        }""")
        print(f"Phaser Size: {phaser_size}")

        browser.close()

if __name__ == "__main__":
    run()
