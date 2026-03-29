import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { GameScene } from "./scenes/GameScene";
import { OnlineGameScene } from "./scenes/OnlineGameScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: "#1a1a2e",
  scale: {
    // FIT scales the canvas to fill the viewport while maintaining 16:9.
    // The body background (#1a1a2e) matches the game background, so the
    // letterbox areas on ultra-wide screens are invisible.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, GameScene, OnlineGameScene],
};

const game = new Phaser.Game(config);

// ResizeObserver fires on every viewport change — orientation, fullscreen,
// browser chrome appearing/disappearing. More reliable than orientationchange alone.
new ResizeObserver(() => game.scale.refresh()).observe(document.body);
document.addEventListener("fullscreenchange", () => game.scale.refresh());
