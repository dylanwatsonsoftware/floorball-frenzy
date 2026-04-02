import LogRocket from "logrocket";
import Phaser from "phaser";

LogRocket.init("floorball/floorball-frenzy");
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
    // EXPAND fills the full viewport without letterboxing — on screens wider
    // than 16:9 the canvas stretches to full width, revealing slightly more
    // of the game world rather than showing black bars.
    mode: Phaser.Scale.EXPAND,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, GameScene, OnlineGameScene],
};

const game = new Phaser.Game(config);

// ResizeObserver fires on every viewport change — orientation, fullscreen,
// browser chrome appearing/disappearing. More reliable than orientationchange alone.
new ResizeObserver(() => game.scale.refresh()).observe(document.body);
document.addEventListener("fullscreenchange", () => game.scale.refresh());
