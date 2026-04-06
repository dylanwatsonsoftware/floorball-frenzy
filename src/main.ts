import LogRocket from "logrocket";
import Phaser from "phaser";
// @ts-ignore
import Scream from "scream";

LogRocket.init("floorball/floorball-frenzy");
import { BootScene } from "./scenes/BootScene";
import { MenuScene } from "./scenes/MenuScene";
import { GameScene } from "./scenes/GameScene";
import { OnlineGameScene } from "./scenes/OnlineGameScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: "100%",
  height: "100%",
  backgroundColor: "#1a1a2e",
  scale: {
    mode: Phaser.Scale.RESIZE,
    fullscreenTarget: 'parent',
    expandParent: true,
  },
  scene: [BootScene, MenuScene, GameScene, OnlineGameScene],
};

const game = new Phaser.Game(config);

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
