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
    mode: Phaser.Scale.ENVELOP,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, GameScene, OnlineGameScene],
};

const game = new Phaser.Game(config);

// Refresh scale after orientation changes so the canvas resizes correctly.
// Small delay lets the browser finish updating its dimensions first.
const refreshScale = (): void => {
  setTimeout(() => game.scale.refresh(), 150);
};
window.addEventListener("orientationchange", refreshScale);
screen.orientation?.addEventListener("change", refreshScale);
