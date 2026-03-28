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
    // FIT: scales to fit within the viewport without cropping.
    // In landscape this fills the screen; in portrait the game renders
    // at the top at full width with empty space below — no forced rotation.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
  },
  fps: {
    target: 60,
    forceSetTimeOut: true, // use setInterval instead of rAF so background tabs keep ticking
  },
  scene: [BootScene, MenuScene, GameScene, OnlineGameScene],
};

const game = new Phaser.Game(config);

// ResizeObserver fires on every viewport change — orientation, fullscreen,
// browser chrome appearing/disappearing. More reliable than orientationchange alone.
new ResizeObserver(() => game.scale.refresh()).observe(document.body);
document.addEventListener("fullscreenchange", () => game.scale.refresh());
