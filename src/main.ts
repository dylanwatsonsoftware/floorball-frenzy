import LogRocket from "logrocket";
import Phaser from "phaser";
import { detectInAppBrowser } from "./utils/browserDetection";
// @ts-ignore
import Scream from "scream";

LogRocket.init("floorball/floorball-frenzy");
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { GameScene } from "./scenes/GameScene";
import { OnlineGameScene } from "./scenes/OnlineGameScene";
import { TutorialScene } from "./scenes/TutorialScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: "#1a1a2e",
  scale: {
    mode: Phaser.Scale.EXPAND,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    fullscreenTarget: 'parent',
    expandParent: true,
  },
  scene: [BootScene, MenuScene, GameScene, OnlineGameScene, TutorialScene],
};

// Handle In-App Browsers (Facebook, Messenger, Instagram, LinkedIn)
const iabInfo = detectInAppBrowser();

const initGame = () => {
  const game = new Phaser.Game(config);
  (window as any).phaserGame = game;

  // Dynamic viewport management for mobile
  const scream = new Scream({
    viewport: true,
    width: {
      portrait: window.screen.width,
      landscape: window.screen.height,
    },
  });

  scream.on("orientationchangeend", () => {
    game.scale.refresh();
  });

  scream.on("viewchange", () => {
    game.scale.refresh();
  });

  new ResizeObserver(() => game.scale.refresh()).observe(document.body);
  document.addEventListener("fullscreenchange", () => game.scale.refresh());
};

if (iabInfo.isInApp) {
  const overlay = document.getElementById("iab-overlay");
  const messageEl = document.getElementById("iab-message");
  const dismissBtn = document.getElementById("iab-dismiss");

  if (overlay && messageEl && dismissBtn) {
    messageEl.innerHTML = `
      It looks like you're playing inside <strong>${iabInfo.appName}</strong>. This game may have issues here.
      <br><br>
      For the best experience, please tap the menu (⋮ or ...) or share icon and select <strong>'Open in Chrome'</strong> or <strong>'Open in Safari'</strong>.
    `;
    overlay.style.display = "flex";

    dismissBtn.addEventListener("click", () => {
      overlay.style.display = "none";
      initGame();
    });
  } else {
    initGame();
  }
} else {
  initGame();
}
