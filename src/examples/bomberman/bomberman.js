class BombermanGame extends Game {
    constructor(renderer) {
        super(renderer);
        // Canvas size
        this.config.screenWidth = 800;
        this.config.screenHeight = 600;

        this.cellSize = 40;
        this.cols = 15; // map width in tiles
        this.rows = 13; // map height in tiles
        this.offsetX = Math.floor((this.config.screenWidth - this.cols * this.cellSize) / 2);
        this.offsetY = 40;

        // Two players for local multiplayer with bomb limits and shield
        this.player1 = { x: 1, y: 1, lives: 3, moveTimer: 0, maxBombs: 1, bombsPlaced: 0, shield: false };
        this.player2 = { x: this.cols - 2, y: this.rows - 2, lives: 3, moveTimer: 0, maxBombs: 1, bombsPlaced: 0, shield: false };

        this.moveInterval = 0.14; // seconds per tile move

        // default bomb settings (used for timer and animation length)
        this.defaultBombTimer = 2.0;
        this.defaultBombRange = 3;

        this.bombs = []; // {x,y, timer, range, owner, animTotal}
        this.explosions = []; // {tiles: [{x,y}], timer}

        this.bricks = []; // destructible bricks
        this.walls = []; // indestructible

        // powerups on the ground
        this.powerups = []; // {x,y,type} type: 'bombUp' | 'shield'

        this.gameOver = false;
    }

    Start() {
        super.Start();

        // Setup input mapping for two players
        Input.ClearMappings();
        // Player 1 - WASD and Space
        Input.RegisterAxis("P1_MoveX", [{ type: 'key', positive: KEY_D, negative: KEY_A }]);
        Input.RegisterAxis("P1_MoveY", [{ type: 'key', positive: KEY_S, negative: KEY_W }]);
        Input.RegisterAction("P1_PlaceBomb", [{ type: 'key', code: KEY_SPACE }]);

        // Player 2 - Arrow keys and Enter
        Input.RegisterAxis("P2_MoveX", [{ type: 'key', positive: KEY_RIGHT, negative: KEY_LEFT }]);
        Input.RegisterAxis("P2_MoveY", [{ type: 'key', positive: KEY_DOWN, negative: KEY_UP }]);
        Input.RegisterAction("P2_PlaceBomb", [{ type: 'key', code: KEY_ENTER }]);

        // Build level: border walls + internal walls + random bricks
        this.bricks = [];
        this.walls = [];
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                // border walls
                if (x === 0 || y === 0 || x === this.cols - 1 || y === this.rows - 1) {
                    this.walls.push({ x, y });
                    continue;
                }
                // fixed internal walls (every other tile)
                if (x % 2 === 0 && y % 2 === 0) {
                    this.walls.push({ x, y });
                    continue;
                }
                // leave starting areas free for both players
                if ((x <= 2 && y <= 2) || (x >= this.cols - 3 && y >= this.rows - 3)) continue;
                // random bricks
                if (Math.random() < 0.5) {
                    this.bricks.push({ x, y });
                }
            }
        }

        // Reset players and game state
        this.player1.x = 1; this.player1.y = 1; this.player1.lives = 3; this.player1.moveTimer = 0; this.player1.maxBombs = 1; this.player1.bombsPlaced = 0; this.player1.shield = false;
        this.player2.x = this.cols - 2; this.player2.y = this.rows - 2; this.player2.lives = 3; this.player2.moveTimer = 0; this.player2.maxBombs = 1; this.player2.bombsPlaced = 0; this.player2.shield = false;
        this.bombs = [];
        this.explosions = [];
        this.powerups = [];

        this._p1Invulnerable = false;
        this._p2Invulnerable = false;
        this.gameOver = false;

        this.hud = new TextLabel(`P1 Lives: ${this.player1.lives}  Bombs: ${this.player1.bombsPlaced}/${this.player1.maxBombs}  Shield: ${this.player1.shield ? 'YES' : 'NO'}    ` +
                                 `P2 Lives: ${this.player2.lives}  Bombs: ${this.player2.bombsPlaced}/${this.player2.maxBombs}  Shield: ${this.player2.shield ? 'YES' : 'NO'}`,
                                 new Vector2(12, 18), "16px Arial", Color.black, "left", "middle", false);
    }

    Update(deltaTime) {
        super.Update(deltaTime);
        if (this.gameOver) return;

        // Movement for both players (grid-based)
        this.HandlePlayerMovement(this.player1, "P1_MoveX", "P1_MoveY", deltaTime);
        this.HandlePlayerMovement(this.player2, "P2_MoveX", "P2_MoveY", deltaTime);

        // pickup powerups for players
        this.CheckPickupPowerups(this.player1);
        this.CheckPickupPowerups(this.player2);

        // Place bombs for both players (respect maxBombs)
        if (Input.GetActionDown("P1_PlaceBomb")) {
            if (this.player1.bombsPlaced < this.player1.maxBombs && !this.bombs.some(b => b.x === this.player1.x && b.y === this.player1.y)) {
                this.bombs.push({ x: this.player1.x, y: this.player1.y, timer: this.defaultBombTimer, animTotal: this.defaultBombTimer, range: this.defaultBombRange, owner: 1 });
                this.player1.bombsPlaced++;
                if (window.BombermanAssets && window.BombermanAssets.playPlaceBomb) window.BombermanAssets.playPlaceBomb();
            }
        }
        if (Input.GetActionDown("P2_PlaceBomb")) {
            if (this.player2.bombsPlaced < this.player2.maxBombs && !this.bombs.some(b => b.x === this.player2.x && b.y === this.player2.y)) {
                this.bombs.push({ x: this.player2.x, y: this.player2.y, timer: this.defaultBombTimer, animTotal: this.defaultBombTimer, range: this.defaultBombRange, owner: 2 });
                this.player2.bombsPlaced++;
                if (window.BombermanAssets && window.BombermanAssets.playPlaceBomb) window.BombermanAssets.playPlaceBomb();
            }
        }

        // Update bombs countdown
        for (let i = this.bombs.length - 1; i >= 0; i--) {
            const b = this.bombs[i];
            b.timer -= deltaTime;
            if (b.timer <= 0) {
                // free owner's bomb slot
                if (b.owner === 1) this.player1.bombsPlaced = Math.max(0, this.player1.bombsPlaced - 1);
                if (b.owner === 2) this.player2.bombsPlaced = Math.max(0, this.player2.bombsPlaced - 1);

                this.ExplodeBomb(b);
                this.bombs.splice(i, 1);
            }
        }

        // Update explosions timer and cleanup
        for (let i = this.explosions.length - 1; i >= 0; i--) {
            const e = this.explosions[i];
            e.timer -= deltaTime;
            if (e.timer <= 0) {
                this.explosions.splice(i, 1);
            }
        }

        // Check player collisions with explosions
        for (const e of this.explosions) {
            if (!this._p1Invulnerable && e.tiles.some(t => t.x === this.player1.x && t.y === this.player1.y)) {
                this.PlayerHit(1);
            }
            if (!this._p2Invulnerable && e.tiles.some(t => t.x === this.player2.x && t.y === this.player2.y)) {
                this.PlayerHit(2);
            }
        }

        // Update HUD
        this.hud.text = `P1 Lives: ${this.player1.lives}  Bombs: ${this.player1.bombsPlaced}/${this.player1.maxBombs}  Shield: ${this.player1.shield ? 'YES' : 'NO'}    ` +
                        `P2 Lives: ${this.player2.lives}  Bombs: ${this.player2.bombsPlaced}/${this.player2.maxBombs}  Shield: ${this.player2.shield ? 'YES' : 'NO'}`;
    }

    HandlePlayerMovement(player, axisXName, axisYName, deltaTime) {
        player.moveTimer += deltaTime;
        if (player.moveTimer >= this.moveInterval) {
            const ax = Input.GetAxis(axisXName);
            const ay = Input.GetAxis(axisYName);
            let moved = false;
            if (ax !== 0) {
                const nx = player.x + (ax > 0 ? 1 : -1);
                const ny = player.y;
                if (!this.IsBlocked(nx, ny) && !this.IsBombAt(nx, ny)) {
                    player.x = nx; moved = true;
                }
            } else if (ay !== 0) {
                const nx = player.x;
                const ny = player.y + (ay > 0 ? 1 : -1);
                if (!this.IsBlocked(nx, ny) && !this.IsBombAt(nx, ny)) {
                    player.y = ny; moved = true;
                }
            }
            if (moved) player.moveTimer = 0;
        }
    }

    CheckPickupPowerups(player) {
        for (let i = this.powerups.length - 1; i >= 0; i--) {
            const p = this.powerups[i];
            if (p.x === player.x && p.y === player.y) {
                if (p.type === 'bombUp') {
                    player.maxBombs = (player.maxBombs || 1) + 1;
                } else if (p.type === 'shield') {
                    player.shield = true;
                }
                this.powerups.splice(i, 1);
            }
        }
    }

    PlayerHit(playerIndex) {
        if (playerIndex === 1) {
            if (this._p1Invulnerable) return;

            // if player has shield consume it
            if (this.player1.shield) {
                this.player1.shield = false;
                this._p1Invulnerable = true;
                setTimeout(() => { this._p1Invulnerable = false; }, 800);
                return;
            }

            this.player1.lives -= 1;
            this._p1Invulnerable = true;
            setTimeout(() => { this._p1Invulnerable = false; }, 800);
            this.player1.x = 1; this.player1.y = 1;
            if (window.BombermanAssets && window.BombermanAssets.playDeath) window.BombermanAssets.playDeath();
            if (this.player1.lives <= 0) {
                this.GameOver();
            }
        } else if (playerIndex === 2) {
            if (this._p2Invulnerable) return;

            if (this.player2.shield) {
                this.player2.shield = false;
                this._p2Invulnerable = true;
                setTimeout(() => { this._p2Invulnerable = false; }, 800);
                return;
            }

            this.player2.lives -= 1;
            this._p2Invulnerable = true;
            setTimeout(() => { this._p2Invulnerable = false; }, 800);
            this.player2.x = this.cols - 2; this.player2.y = this.rows - 2;
            if (window.BombermanAssets && window.BombermanAssets.playDeath) window.BombermanAssets.playDeath();
            if (this.player2.lives <= 0) {
                this.GameOver();
            }
        }
    }

    GameOver() {
        this.gameOver = true;
        if (window.BombermanAssets && window.BombermanAssets.playDeath) window.BombermanAssets.playDeath();
        // simple text - the HUD will still show 0 lives
        const text = new TextLabel("GAME OVER - Click Start to restart", new Vector2(this.config.screenWidth / 2, this.config.screenHeight / 2), "20px Arial", Color.black, "center", "middle", false);
        text.Draw(this.renderer);
    }

    IsBombAt(x, y) { return this.bombs.some(b => b.x === x && b.y === y); }

    IsBlocked(x, y) {
        // outside
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return true;
        if (this.walls.some(w => w.x === x && w.y === y)) return true;
        if (this.bricks.some(b => b.x === x && b.y === y)) return true;
        return false;
    }

    ExplodeBomb(bomb) {
        const tiles = [];
        tiles.push({ x: bomb.x, y: bomb.y });
        const dirs = [ {dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1} ];
        for (const d of dirs) {
            for (let r = 1; r <= bomb.range; r++) {
                const tx = bomb.x + d.dx * r;
                const ty = bomb.y + d.dy * r;
                // stop at walls
                if (this.walls.some(w => w.x === tx && w.y === ty)) break;
                tiles.push({ x: tx, y: ty });
                // if brick -> destroy and stop (and maybe spawn a powerup)
                const bIndex = this.bricks.findIndex(b => b.x === tx && b.y === ty);
                if (bIndex !== -1) {
                    // when brick destroyed there's a chance to spawn a powerup
                    if (Math.random() < 0.25) {
                        // pick powerup type
                        const type = Math.random() < 0.5 ? 'bombUp' : 'shield';
                        this.powerups.push({ x: tx, y: ty, type });
                    }
                    this.bricks.splice(bIndex, 1);
                    break;
                }
            }
        }
        this.explosions.push({ tiles: tiles, timer: 0.55 });
        if (window.BombermanAssets && window.BombermanAssets.playExplosion) window.BombermanAssets.playExplosion();
    }

    Draw() {
        super.Draw();
        const cw = this.config.screenWidth;
        const ch = this.config.screenHeight;
        // clear
        this.renderer.DrawFillBasicRectangle(0, 0, cw, ch, Color.white);

        // draw grid background (light grid lines)
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const px = this.offsetX + x * this.cellSize;
                const py = this.offsetY + y * this.cellSize;
                this.renderer.DrawStrokeBasicRectangle(px, py, this.cellSize, this.cellSize, Color.lightGrey, 1);
            }
        }

        // draw walls - solid black
        for (const w of this.walls) {
            const px = this.offsetX + w.x * this.cellSize;
            const py = this.offsetY + w.y * this.cellSize;
            this.renderer.DrawFillBasicRectangle(px, py, this.cellSize, this.cellSize, Color.black);
            this.renderer.DrawStrokeBasicRectangle(px, py, this.cellSize, this.cellSize, Color.white, 1);
        }

        // draw bricks - solid brown
        const brickColor = Color.FromRGB(205, 133, 63);
        for (const b of this.bricks) {
            const px = this.offsetX + b.x * this.cellSize;
            const py = this.offsetY + b.y * this.cellSize;
            this.renderer.DrawFillBasicRectangle(px, py, this.cellSize, this.cellSize, brickColor);
            this.renderer.DrawStrokeBasicRectangle(px + 2, py + 2, this.cellSize - 4, this.cellSize - 4, Color.black, 1);
        }

        // draw powerups
        for (const p of this.powerups) {
            const px = this.offsetX + p.x * this.cellSize;
            const py = this.offsetY + p.y * this.cellSize;
            if (p.type === 'bombUp') {
                this.renderer.DrawFillBasicRectangle(px + 10, py + 10, this.cellSize - 20, this.cellSize - 20, Color.yellow);
                this.renderer.DrawStrokeBasicRectangle(px + 10, py + 10, this.cellSize - 20, this.cellSize - 20, Color.black, 1);
            } else if (p.type === 'shield') {
                this.renderer.DrawFillBasicRectangle(px + 10, py + 10, this.cellSize - 20, this.cellSize - 20, Color.FromRGB(135,206,250));
                this.renderer.DrawStrokeBasicRectangle(px + 10, py + 10, this.cellSize - 20, this.cellSize - 20, Color.black, 1);
            }
        }

        // draw bombs
        for (const b of this.bombs) {
            const px = this.offsetX + b.x * this.cellSize;
            const py = this.offsetY + b.y * this.cellSize;

            // Animation: sprite sheet 4 frames (16x16) in a 64x16 image
            const sheet = window.BombermanAssets && window.BombermanAssets.bombSprites ? window.BombermanAssets.bombSprites : null;
            const frameCount = 4;
            const frameW = 16, frameH = 16;

            // compute progress from start to explosion
            const total = b.animTotal || this.defaultBombTimer; // fallback to default
            const progress = Math.max(0, Math.min(1, 1 - (b.timer / total)));
            let frame = Math.floor(progress * frameCount);
            if (frame >= frameCount) frame = frameCount - 1;

            const destW = Math.floor(this.cellSize * 0.6);
            const destH = destW;
            const bx = px + Math.floor((this.cellSize - destW) / 2); // top-left for DrawImageSectionBasic
            const by = py + Math.floor((this.cellSize - destH) / 2);

            // compute scale factors expected by renderer methods (they expect scales, not pixel sizes)
            const scaleX = destW / frameW;
            const scaleY = destH / frameH;

            if (sheet && sheet.complete && typeof this.renderer.DrawImageSectionBasic === 'function') {
                // DrawImageSectionBasic(img, x, y, sx, sy, sw, sh, scaleX, scaleY)
                const sx = frame * frameW;
                const sy = 0;
                this.renderer.DrawImageSectionBasic(sheet, bx, by, sx, sy, frameW, frameH, scaleX, scaleY);
            }
            else if (sheet && sheet.complete && typeof this.renderer.DrawImageSection === 'function') {
                // DrawImageSection expects the draw position to be the center for many renderer implementations
                const sx = frame * frameW;
                const sy = 0;
                const cx = px + Math.floor(this.cellSize / 2);
                const cy = py + Math.floor(this.cellSize / 2);
                this.renderer.DrawImageSection(sheet, cx, cy, sx, sy, frameW, frameH, scaleX, scaleY);
            }
            else {
                // fallback: colored square by owner
                const bw = Math.floor(this.cellSize * 0.5);
                const bh = bw;
                const obx = px + Math.floor((this.cellSize - bw) / 2);
                const oby = py + Math.floor((this.cellSize - bh) / 2);
                const bombColor = b.owner === 1 ? Color.black : Color.purple;
                this.renderer.DrawFillBasicRectangle(obx, oby, bw, bh, bombColor);
                this.renderer.DrawStrokeBasicRectangle(obx, oby, bw, bh, Color.white, 2);
            }
        }

        // draw explosions
        for (const e of this.explosions) {
            for (const t of e.tiles) {
                const px = this.offsetX + t.x * this.cellSize;
                const py = this.offsetY + t.y * this.cellSize;
                this.renderer.DrawFillBasicRectangle(px, py, this.cellSize, this.cellSize, Color.orange);
            }
        }

        // draw players
        const p1x = this.offsetX + this.player1.x * this.cellSize;
        const p1y = this.offsetY + this.player1.y * this.cellSize;
        const pad = 6;
        // draw shield indicator as outline when active
        if (this.player1.shield) {
            this.renderer.DrawStrokeBasicRectangle(p1x + pad/2 - 2, p1y + pad/2 - 2, this.cellSize - pad + 4, this.cellSize - pad + 4, Color.FromRGB(135,206,250), 3);
        }
        this.renderer.DrawFillBasicRectangle(p1x + pad/2, p1y + pad/2, this.cellSize - pad, this.cellSize - pad, Color.cyan);
        this.renderer.DrawStrokeBasicRectangle(p1x + pad/2, p1y + pad/2, this.cellSize - pad, this.cellSize - pad, Color.black, 2);

        const p2x = this.offsetX + this.player2.x * this.cellSize;
        const p2y = this.offsetY + this.player2.y * this.cellSize;
        if (this.player2.shield) {
            this.renderer.DrawStrokeBasicRectangle(p2x + pad/2 - 2, p2y + pad/2 - 2, this.cellSize - pad + 4, this.cellSize - pad + 4, Color.FromRGB(135,206,250), 3);
        }
        this.renderer.DrawFillBasicRectangle(p2x + pad/2, p2y + pad/2, this.cellSize - pad, this.cellSize - pad, Color.purple);
        this.renderer.DrawStrokeBasicRectangle(p2x + pad/2, p2y + pad/2, this.cellSize - pad, this.cellSize - pad, Color.white, 2);

        // HUD
        this.hud.Draw(this.renderer);
    }
}
