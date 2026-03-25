// WebAudio helpers for Bomberman SFX. Kept in JS so HTML only wires UI.
window.BombermanAudio = (function createBombermanAudio() {
    let audioCtx = null;
    let audioMasterGain = null;

    function ensureAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    function ensureMasterGain() {
        ensureAudio();
        if (!audioMasterGain) {
            audioMasterGain = audioCtx.createGain();
            const vol = (typeof window.GameVolume !== 'undefined') ? Number(window.GameVolume) : 1.0;
            audioMasterGain.gain.setValueAtTime(isFinite(vol) ? Math.max(0, vol) : 1.0, audioCtx.currentTime);
            audioMasterGain.connect(audioCtx.destination);
        }
    }

    function getVolume() {
        let vol = Number(window.GameVolume);
        if (!isFinite(vol) || vol < 0) vol = 1.0;
        return Math.max(0.0, vol);
    }

    function playPlaceBomb() {
        ensureAudio();
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(440, audioCtx.currentTime);
        const vol = getVolume();
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.09 * Math.max(0.0001, vol), audioCtx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.2);
        o.connect(g);
        ensureMasterGain();
        g.connect(audioMasterGain);
        o.start(); o.stop(audioCtx.currentTime + 0.22);
    }

    function playExplosion() {
        ensureAudio();
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(120, audioCtx.currentTime);
        const vol = getVolume();
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.3 * Math.max(0.0001, vol), audioCtx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.6);
        o.connect(g);
        ensureMasterGain();
        g.connect(audioMasterGain);
        o.start(); o.stop(audioCtx.currentTime + 0.6);
    }

    function playDeath() {
        ensureAudio();
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(200, audioCtx.currentTime);
        const vol = getVolume();
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.2 * Math.max(0.0001, vol), audioCtx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.7);
        o.connect(g);
        ensureMasterGain();
        g.connect(audioMasterGain);
        o.start(); o.stop(audioCtx.currentTime + 0.7);
    }

    function setVolume(v) {
        const vol = Number(v);
        if (!isFinite(vol)) return;
        window.GameVolume = Math.max(0, vol);
        if (audioMasterGain && audioCtx) {
            try { audioMasterGain.gain.setValueAtTime(Math.max(0, vol), audioCtx.currentTime); } catch (e) { }
        }
    }

    return {
        playPlaceBomb,
        playExplosion,
        playDeath,
        setVolume
    };
})();

class BombermanGame extends Game {
    constructor(renderer) {
        super(renderer);

        // Disable image smoothing for crisp pixel art (scale 16x16 sprites with nearest neighbor)
        this.config.imageSmoothingEnabled = false;

        // Tile and map configuration
        this.cellSize = 40;
        this.cols = 15; // map width in tiles
        this.rows = 13; // map height in tiles

        // Set canvas size to exactly fit the tile map (no extra space outside walls)
        this.config.screenWidth = this.cols * this.cellSize;   // width in pixels
        this.config.screenHeight = this.rows * this.cellSize;  // height in pixels

        // No additional offset; map draws from canvas top-left
        this.offsetX = 0;
        this.offsetY = 0;

        // Two players for local multiplayer with bomb limits and shield
        this.player1 = { x: 1, y: 1, lives: 3, moveTimer: 0, maxBombs: 1, bombsPlaced: 0, shield: false };
        this.player2 = { x: this.cols - 2, y: this.rows - 2, lives: 3, moveTimer: 0, maxBombs: 1, bombsPlaced: 0, shield: false };

        // animation state per player (will be initialized/reset in Start())
        // dir: 0=forward(down),1=left,2=right,3=back(up)
        // animFrame: current frame index (0..frameCount-1), animTimer: time accumulator
        // isMoving: whether player moved in last tick
        this.player1.anim = { dir:0, animFrame:0, animTimer:0, frameDuration:0.12, frameCount:3, isMoving:false };
        this.player2.anim = { dir:0, animFrame:0, animTimer:0, frameDuration:0.12, frameCount:3, isMoving:false };

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
        // reset animation state
        this.player1.anim.dir = 0; this.player1.anim.animFrame = 1; this.player1.anim.animTimer = 0; this.player1.anim.isMoving = false;
        this.player2.anim.dir = 0; this.player2.anim.animFrame = 1; this.player2.anim.animTimer = 0; this.player2.anim.isMoving = false;
        this.bombs = [];
        this.explosions = [];
        this.powerups = [];

        // initialize smooth movement pixel positions and movement state
        const p1cx = this.offsetX + this.player1.x * this.cellSize + Math.floor(this.cellSize/2);
        const p1cy = this.offsetY + this.player1.y * this.cellSize + Math.floor(this.cellSize/2);
        this.player1.pixelPos = new Vector2(p1cx, p1cy);
        this.player1.moving = false;
        this.player1.moveFrom = Vector2.Copy(this.player1.pixelPos);
        this.player1.moveTo = Vector2.Copy(this.player1.pixelPos);
        this.player1.moveProgress = 0;
        this.player1.moveDuration = this.moveInterval;

        const p2cx = this.offsetX + this.player2.x * this.cellSize + Math.floor(this.cellSize/2);
        const p2cy = this.offsetY + this.player2.y * this.cellSize + Math.floor(this.cellSize/2);
        this.player2.pixelPos = new Vector2(p2cx, p2cy);
        this.player2.moving = false;
        this.player2.moveFrom = Vector2.Copy(this.player2.pixelPos);
        this.player2.moveTo = Vector2.Copy(this.player2.pixelPos);
        this.player2.moveProgress = 0;
        this.player2.moveDuration = this.moveInterval;

        this._p1Invulnerable = false;
        this._p2Invulnerable = false;
        this.gameOver = false;

        // Create SSAnimation objects for players (3-frame loops per direction)
        const p1Img = (window.BombermanAssets && window.BombermanAssets.playerSpriteP1) ? window.BombermanAssets.playerSpriteP1 : null;
        const p2Img = (window.BombermanAssets && window.BombermanAssets.playerSpriteP2) ? window.BombermanAssets.playerSpriteP2 : null;
        // frameWidth/frameHeight are 64x64, 4 directions (rows), 3 frames each => [3,3,3,3]
        // Use slightly reduced scale (0.8) and shift pivot on Y
        this.player1.animObj = new SSAnimationObjectBasic(new Vector2(this.offsetX + this.player1.x * this.cellSize + this.cellSize/2, this.offsetY + this.player1.y * this.cellSize + this.cellSize/2), 0, 0.8, p1Img, 64, 64, [3,3,3,3], this.player1.anim.frameDuration);
        this.player2.animObj = new SSAnimationObjectBasic(new Vector2(this.offsetX + this.player2.x * this.cellSize + this.cellSize/2, this.offsetY + this.player2.y * this.cellSize + this.cellSize/2), 0, 0.8, p2Img, 64, 64, [3,3,3,3], this.player2.anim.frameDuration);
        // Crop out an extra top pixel row from player sprites (source offset Y = 1)
        if (this.player1.animObj) this.player1.animObj.sourceOffset = new Vector2(0, 1);
        if (this.player2.animObj) this.player2.animObj.sourceOffset = new Vector2(0, 1);
        // move the pivot point higher on the sprite by 10 pixels (anchor up)
        if (this.player1.animObj && this.player1.animObj.sprite) this.player1.animObj.sprite.pivot.y = 10;
        if (this.player2.animObj && this.player2.animObj.sprite) this.player2.animObj.sprite.pivot.y = 10;

        this.hud = new TextLabel(`P1 Lives: ${this.player1.lives}  Bombs: ${Math.max(0, this.player1.maxBombs - this.player1.bombsPlaced)}  Shield: ${this.player1.shield ? 'YES' : 'NO'}    ` +
             `P2 Lives: ${this.player2.lives}  Bombs: ${Math.max(0, this.player2.maxBombs - this.player2.bombsPlaced)}  Shield: ${this.player2.shield ? 'YES' : 'NO'}`,
             new Vector2(12, 18), "16px pixelFont2", Color.black, "left", "middle", false);
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
                // create bomb with SSAnimation attached
                const bx = this.offsetX + this.player1.x * this.cellSize + Math.floor(this.cellSize/2);
                const by = this.offsetY + this.player1.y * this.cellSize + Math.floor(this.cellSize/2);
                const bombImg = (window.BombermanAssets && window.BombermanAssets.bombSprites) ? window.BombermanAssets.bombSprites : null;
                const bObj = { x: this.player1.x, y: this.player1.y, timer: this.defaultBombTimer, animTotal: this.defaultBombTimer, range: this.defaultBombRange, owner: 1 };
                // scale 2.0 to render bomb frames twice their original size
                if (bombImg) {
                    bObj.anim = new SSAnimationObjectBasic(new Vector2(bx, by), 0, 2.4, bombImg, 16, 16, [4], (this.defaultBombTimer / 4));
                    bObj.anim.playing = true;
                }
                this.bombs.push(bObj);
                this.player1.bombsPlaced++;
                if (window.BombermanAssets && window.BombermanAssets.playPlaceBomb) window.BombermanAssets.playPlaceBomb();
            }
        }
        if (Input.GetActionDown("P2_PlaceBomb")) {
            if (this.player2.bombsPlaced < this.player2.maxBombs && !this.bombs.some(b => b.x === this.player2.x && b.y === this.player2.y)) {
                const bx = this.offsetX + this.player2.x * this.cellSize + Math.floor(this.cellSize/2);
                const by = this.offsetY + this.player2.y * this.cellSize + Math.floor(this.cellSize/2);
                const bombImg = (window.BombermanAssets && window.BombermanAssets.bombSprites) ? window.BombermanAssets.bombSprites : null;
                const bObj = { x: this.player2.x, y: this.player2.y, timer: this.defaultBombTimer, animTotal: this.defaultBombTimer, range: this.defaultBombRange, owner: 2 };
                // scale 2.0 to render bomb frames twice their original size
                if (bombImg) {
                    bObj.anim = new SSAnimationObjectBasic(new Vector2(bx, by), 0, 2.4, bombImg, 16, 16, [4], (this.defaultBombTimer / 4));
                    bObj.anim.playing = true;
                }
                this.bombs.push(bObj);
                this.player2.bombsPlaced++;
                if (window.BombermanAssets && window.BombermanAssets.playPlaceBomb) window.BombermanAssets.playPlaceBomb();
            }
        }

        // Update bombs countdown
        for (let i = this.bombs.length - 1; i >= 0; i--) {
            const b = this.bombs[i];
            b.timer -= deltaTime;
            // update attached animation if present
            if (b.anim) {
                // update animation position to the center of the tile
                const px = this.offsetX + b.x * this.cellSize + Math.floor(this.cellSize/2);
                const py = this.offsetY + b.y * this.cellSize + Math.floor(this.cellSize/2);
                b.anim.position = new Vector2(px, py);
                b.anim.Update(deltaTime);
            }
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
        this.hud.text = `P1 Lives: ${this.player1.lives}  Bombs: ${Math.max(0, this.player1.maxBombs - this.player1.bombsPlaced)}  Shield: ${this.player1.shield ? 'YES' : 'NO'}    ` +
                `P2 Lives: ${this.player2.lives}  Bombs: ${Math.max(0, this.player2.maxBombs - this.player2.bombsPlaced)}  Shield: ${this.player2.shield ? 'YES' : 'NO'}`;

        // Update player animations: advance sprite animation only when moving
        this.UpdatePlayerAnimation(this.player1, deltaTime);
        this.UpdatePlayerAnimation(this.player2, deltaTime);

        if (this.player1.animObj) {
            this.player1.animObj.PlayAnimationLoop(this.player1.anim.dir, false);
            if (this.player1.anim.isMoving) {
                this.player1.animObj.playing = true;
                this.player1.animObj.Update(deltaTime);
            } else {
                this.player1.animObj.playing = false;
                // show idle middle frame
                const maxFrames = this.player1.animObj.frameCount[this.player1.anim.dir] || 1;
                this.player1.animObj.actualFrame = Math.min(1, maxFrames - 1);
                this.player1.animObj.actualFrameCountTime = 0;
            }
        }

        if (this.player2.animObj) {
            this.player2.animObj.PlayAnimationLoop(this.player2.anim.dir, false);
            if (this.player2.anim.isMoving) {
                this.player2.animObj.playing = true;
                this.player2.animObj.Update(deltaTime);
            } else {
                this.player2.animObj.playing = false;
                const maxFrames2 = this.player2.animObj.frameCount[this.player2.anim.dir] || 1;
                this.player2.animObj.actualFrame = Math.min(1, maxFrames2 - 1);
                this.player2.animObj.actualFrameCountTime = 0;
            }
        }
    }

    HandlePlayerMovement(player, axisXName, axisYName, deltaTime) {
        // If currently interpolating movement, advance progress
        if (player.moving) {
            player.moveProgress += deltaTime;
            const t = Math.min(1, player.moveProgress / player.moveDuration);
            // linear interpolation between from and to
            player.pixelPos.Set(
                player.moveFrom.x + (player.moveTo.x - player.moveFrom.x) * t,
                player.moveFrom.y + (player.moveTo.y - player.moveFrom.y) * t
            );
            if (t >= 1) {
                // finish movement: commit grid coords
                player.moving = false;
                player.moveProgress = 0;
                if (typeof player.targetX !== 'undefined') player.x = player.targetX;
                if (typeof player.targetY !== 'undefined') player.y = player.targetY;
                // keep anim.isMoving true if input axis still pressed so animation doesn't reset between tiles
                const ax_now = Input.GetAxis(axisXName);
                const ay_now = Input.GetAxis(axisYName);
                player.anim.isMoving = (ax_now !== 0 || ay_now !== 0);
            }
            return;
        }

        // Not moving: check input and start movement if a direction is pressed
        const ax = Input.GetAxis(axisXName);
        const ay = Input.GetAxis(axisYName);
        let started = false;
        if (ax !== 0) {
            const nx = player.x + (ax > 0 ? 1 : -1);
            const ny = player.y;
            if (!this.IsBlocked(nx, ny) && !this.IsBombAt(nx, ny)) {
                // start smooth move
                player.targetX = nx; player.targetY = ny;
                player.moveFrom = Vector2.Copy(player.pixelPos);
                player.moveTo = new Vector2(this.offsetX + nx * this.cellSize + Math.floor(this.cellSize/2), this.offsetY + ny * this.cellSize + Math.floor(this.cellSize/2));
                player.moveProgress = 0;
                player.moveDuration = this.moveInterval;
                player.moving = true;
                // set animation direction (left/right)
                player.anim.dir = ax > 0 ? 2 : 1;
                player.anim.isMoving = true;
                player.anim.animFrame = 0;
                player.anim.animTimer = 0;
                started = true;
            }
        } else if (ay !== 0) {
            const nx = player.x;
            const ny = player.y + (ay > 0 ? 1 : -1);
            if (!this.IsBlocked(nx, ny) && !this.IsBombAt(nx, ny)) {
                player.targetX = nx; player.targetY = ny;
                player.moveFrom = Vector2.Copy(player.pixelPos);
                player.moveTo = new Vector2(this.offsetX + nx * this.cellSize + Math.floor(this.cellSize/2), this.offsetY + ny * this.cellSize + Math.floor(this.cellSize/2));
                player.moveProgress = 0;
                player.moveDuration = this.moveInterval;
                player.moving = true;
                // set animation direction (down/up)
                player.anim.dir = ay > 0 ? 0 : 3;
                player.anim.isMoving = true;
                player.anim.animFrame = 0;
                player.anim.animTimer = 0;
                started = true;
            }
        }

        if (!started) {
            player.anim.isMoving = false;
        }
    }

    UpdatePlayerAnimation(player, deltaTime) {
        const a = player.anim;
        if (a.isMoving) {
            a.animTimer += deltaTime;
            if (a.animTimer >= a.frameDuration) {
                a.animFrame = (a.animFrame + 1) % a.frameCount;
                a.animTimer = 0;
            }
        } else {
            // idle frame in the middle (1) for 3-frame animations
            a.animFrame = Math.min(1, a.frameCount - 1);
            a.animTimer = 0;
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
                // cancel any smooth movement in progress
                this.player1.moving = false;
                this.player1.moveProgress = 0;
                delete this.player1.targetX; delete this.player1.targetY;
                // snap pixel position to current logical tile center
                this.player1.pixelPos = new Vector2(this.offsetX + this.player1.x * this.cellSize + Math.floor(this.cellSize/2), this.offsetY + this.player1.y * this.cellSize + Math.floor(this.cellSize/2));
                this.player1.moveFrom = Vector2.Copy(this.player1.pixelPos);
                this.player1.moveTo = Vector2.Copy(this.player1.pixelPos);
                return;
            }

            this.player1.lives -= 1;
            this._p1Invulnerable = true;
            setTimeout(() => { this._p1Invulnerable = false; }, 800);
            this.player1.x = 1; this.player1.y = 1;
            // cancel any smooth movement in progress and snap to respawn
            this.player1.moving = false;
            this.player1.moveProgress = 0;
            delete this.player1.targetX; delete this.player1.targetY;
            this.player1.pixelPos = new Vector2(this.offsetX + this.player1.x * this.cellSize + Math.floor(this.cellSize/2), this.offsetY + this.player1.y * this.cellSize + Math.floor(this.cellSize/2));
            this.player1.moveFrom = Vector2.Copy(this.player1.pixelPos);
            this.player1.moveTo = Vector2.Copy(this.player1.pixelPos);
            if (window.BombermanAssets && window.BombermanAssets.playDeath) window.BombermanAssets.playDeath();
            if (this.player1.lives <= 0) {
                // player2 wins
                this.GameOver(2);
            }
        } else if (playerIndex === 2) {
            if (this._p2Invulnerable) return;

            if (this.player2.shield) {
                this.player2.shield = false;
                this._p2Invulnerable = true;
                setTimeout(() => { this._p2Invulnerable = false; }, 800);
                // cancel any smooth movement in progress
                this.player2.moving = false;
                this.player2.moveProgress = 0;
                delete this.player2.targetX; delete this.player2.targetY;
                this.player2.pixelPos = new Vector2(this.offsetX + this.player2.x * this.cellSize + Math.floor(this.cellSize/2), this.offsetY + this.player2.y * this.cellSize + Math.floor(this.cellSize/2));
                this.player2.moveFrom = Vector2.Copy(this.player2.pixelPos);
                this.player2.moveTo = Vector2.Copy(this.player2.pixelPos);
                return;
            }

            this.player2.lives -= 1;
            this._p2Invulnerable = true;
            setTimeout(() => { this._p2Invulnerable = false; }, 800);
            this.player2.x = this.cols - 2; this.player2.y = this.rows - 2;
            // cancel any smooth movement in progress and snap to respawn
            this.player2.moving = false;
            this.player2.moveProgress = 0;
            delete this.player2.targetX; delete this.player2.targetY;
            this.player2.pixelPos = new Vector2(this.offsetX + this.player2.x * this.cellSize + Math.floor(this.cellSize/2), this.offsetY + this.player2.y * this.cellSize + Math.floor(this.cellSize/2));
            this.player2.moveFrom = Vector2.Copy(this.player2.pixelPos);
            this.player2.moveTo = Vector2.Copy(this.player2.pixelPos);
            if (window.BombermanAssets && window.BombermanAssets.playDeath) window.BombermanAssets.playDeath();
            if (this.player2.lives <= 0) {
                // player1 wins
                this.GameOver(1);
            }
        }
    }

    GameOver() {
        // if called without winner, just set game over
        this.gameOver = true;
        if (window.BombermanAssets && window.BombermanAssets.playDeath) window.BombermanAssets.playDeath();
        // if an overlay function exists in the page, invoke it with the winner id
        if (arguments.length > 0) {
            const winner = arguments[0];
            if (typeof window.ShowGameOver === 'function') {
                window.ShowGameOver(winner);
            }
        } else {
            // fallback: draw simple text
            const text = new TextLabel("GAME OVER - Click Start to restart", new Vector2(this.config.screenWidth / 2, this.config.screenHeight / 2), "20px pixelFont2", Color.black, "center", "middle", false);
            text.Draw(this.renderer);
        }
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
        // store center coords so drawing code can determine directions
        this.explosions.push({ tiles: tiles, timer: 0.55, cx: bomb.x, cy: bomb.y });
        if (window.BombermanAssets && window.BombermanAssets.playExplosion) window.BombermanAssets.playExplosion();
    }

    Draw() {
        super.Draw();
        const cw = this.config.screenWidth;
        const ch = this.config.screenHeight;
        // clear
        this.renderer.DrawFillBasicRectangle(0, 0, cw, ch, Color.FromRGB(69, 210, 115));

        // grid lines removed (empty tiles show background color)

        // draw walls - use wall image if available, otherwise solid black fallback
        const wallImg = (window.BombermanAssets && window.BombermanAssets.wallImage) ? window.BombermanAssets.wallImage : null;
        for (const w of this.walls) {
            const px = this.offsetX + w.x * this.cellSize;
            const py = this.offsetY + w.y * this.cellSize;
            if (wallImg && wallImg.complete) {
                this.renderer.DrawImageBasic(wallImg, px, py, this.cellSize, this.cellSize);
            } else {
                this.renderer.DrawFillBasicRectangle(px, py, this.cellSize, this.cellSize, Color.black);
                this.renderer.DrawStrokeBasicRectangle(px, py, this.cellSize, this.cellSize, Color.white, 1);
            }
        }

        // draw bricks - use brick image if available (scale 16x16 -> cellSize), otherwise solid brown fallback
        const brickImg = (window.BombermanAssets && window.BombermanAssets.brickImage) ? window.BombermanAssets.brickImage : null;
        const brickColor = Color.FromRGB(205, 133, 63);
        for (const b of this.bricks) {
            const px = this.offsetX + b.x * this.cellSize;
            const py = this.offsetY + b.y * this.cellSize;
            if (brickImg && brickImg.complete) {
                this.renderer.DrawImageBasic(brickImg, px, py, this.cellSize, this.cellSize);
            } else {
                this.renderer.DrawFillBasicRectangle(px, py, this.cellSize, this.cellSize, brickColor);
                this.renderer.DrawStrokeBasicRectangle(px + 2, py + 2, this.cellSize - 4, this.cellSize - 4, Color.black, 1);
            }
        }

        // draw powerups (use provided images if available; images are 16x16 and will be scaled to tile size)
        for (const p of this.powerups) {
            const px = this.offsetX + p.x * this.cellSize;
            const py = this.offsetY + p.y * this.cellSize;
            if (p.type === 'bombUp') {
                const img = (window.BombermanAssets && window.BombermanAssets.bombPowerup) ? window.BombermanAssets.bombPowerup : null;
                if (img && img.complete) {
                    this.renderer.DrawImageBasic(img, px, py, this.cellSize, this.cellSize);
                } else {
                    this.renderer.DrawFillBasicRectangle(px + 10, py + 10, this.cellSize - 20, this.cellSize - 20, Color.yellow);
                    this.renderer.DrawStrokeBasicRectangle(px + 10, py + 10, this.cellSize - 20, this.cellSize - 20, Color.black, 1);
                }
            } else if (p.type === 'shield') {
                const img = (window.BombermanAssets && window.BombermanAssets.shieldPowerup) ? window.BombermanAssets.shieldPowerup : null;
                if (img && img.complete) {
                    this.renderer.DrawImageBasic(img, px, py, this.cellSize, this.cellSize);
                } else {
                    this.renderer.DrawFillBasicRectangle(px + 10, py + 10, this.cellSize - 20, this.cellSize - 20, Color.FromRGB(135,206,250));
                    this.renderer.DrawStrokeBasicRectangle(px + 10, py + 10, this.cellSize - 20, this.cellSize - 20, Color.black, 1);
                }
            }
        }

        // draw bombs
        for (const b of this.bombs) {
            // use attached SSAnimation if present
            if (b.anim && b.anim.img && b.anim.img.complete) {
                b.anim.Draw(this.renderer);
            }
            else {
                const px = this.offsetX + b.x * this.cellSize;
                const py = this.offsetY + b.y * this.cellSize;
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

        // draw explosions using explosion sprite parts (no smoothing)
        const centerImg = (window.BombermanAssets && window.BombermanAssets.centerFire) ? window.BombermanAssets.centerFire : null;
        const middleImg = (window.BombermanAssets && window.BombermanAssets.middleFire) ? window.BombermanAssets.middleFire : null;
        const endImg = (window.BombermanAssets && window.BombermanAssets.endFire) ? window.BombermanAssets.endFire : null;
        for (const e of this.explosions) {
            for (const t of e.tiles) {
                const px = this.offsetX + t.x * this.cellSize;
                const py = this.offsetY + t.y * this.cellSize;
                const dx = t.x - e.cx;
                const dy = t.y - e.cy;

                // center
                if (dx === 0 && dy === 0) {
                    if (centerImg && centerImg.complete) {
                        this.renderer.DrawImageBasic(centerImg, px, py, this.cellSize, this.cellSize);
                    } else {
                        this.renderer.DrawFillBasicRectangle(px, py, this.cellSize, this.cellSize, Color.orange);
                    }
                    continue;
                }

                // determine direction and magnitude
                let dir = null;
                let mag = 0;
                if (dx !== 0) { dir = dx > 0 ? 'right' : 'left'; mag = Math.abs(dx); }
                else { dir = dy > 0 ? 'down' : 'up'; mag = Math.abs(dy); }

                // check if this is the last tile in this direction
                const hasFurther = e.tiles.some(tt => {
                    if (dir === 'right') return tt.y === e.cy && tt.x > t.x;
                    if (dir === 'left') return tt.y === e.cy && tt.x < t.x;
                    if (dir === 'down') return tt.x === e.cx && tt.y > t.y;
                    return tt.x === e.cx && tt.y < t.y;
                });
                const isEnd = !hasFurther;

                // choose image and rotation
                let img = isEnd ? endImg : middleImg;
                if (img && img.complete) {
                    const cx = px + Math.floor(this.cellSize / 2);
                    const cy = py + Math.floor(this.cellSize / 2);
                    const angle = (dir === 'right') ? 0 : (dir === 'left') ? Math.PI : (dir === 'down') ? Math.PI/2 : -Math.PI/2;
                    const scale = this.cellSize / img.width;
                    // DrawImageSection supports rotation and scaling around center
                    this.renderer.DrawImageSection(img, cx, cy, 0, 0, img.width, img.height, scale, scale, angle, { x: 0, y: 0 }, 1.0);
                } else {
                    this.renderer.DrawFillBasicRectangle(px, py, this.cellSize, this.cellSize, Color.orange);
                }
            }
        }

        // draw players (use smooth pixel positions if available)
        const p1x = (this.player1.pixelPos) ? (this.player1.pixelPos.x - Math.floor(this.cellSize/2)) : (this.offsetX + this.player1.x * this.cellSize);
        const p1y = (this.player1.pixelPos) ? (this.player1.pixelPos.y - Math.floor(this.cellSize/2)) : (this.offsetY + this.player1.y * this.cellSize);
        const pad = 6;
        // draw shield indicator as outline when active
        if (this.player1.shield) {
            this.renderer.DrawStrokeBasicRectangle(p1x + pad/2 - 2, p1y + pad/2 - 2, this.cellSize - pad + 4, this.cellSize - pad + 4, Color.FromRGB(255,228,0), 3);
        }
        // draw player1 using SSAnimation object if available
        if (this.player1.animObj) {
            const cx = (this.player1.pixelPos) ? this.player1.pixelPos.x : (p1x + Math.floor(this.cellSize / 2));
            const cy = (this.player1.pixelPos) ? this.player1.pixelPos.y : (p1y + Math.floor(this.cellSize / 2));
            this.player1.animObj.position = new Vector2(cx, cy);
            // set proper animation row (direction) without resetting frame
            this.player1.animObj.PlayAnimationLoop(this.player1.anim.dir, false);
            if (this.player1.animObj.img && this.player1.animObj.img.complete) {
                this.player1.animObj.Draw(this.renderer);
            }
            else {
                this.renderer.DrawFillBasicRectangle(p1x + pad/2, p1y + pad/2, this.cellSize - pad, this.cellSize - pad, Color.cyan);
                this.renderer.DrawStrokeBasicRectangle(p1x + pad/2, p1y + pad/2, this.cellSize - pad, this.cellSize - pad, Color.black, 2);
            }
        }
        else {
            this.renderer.DrawFillBasicRectangle(p1x + pad/2, p1y + pad/2, this.cellSize - pad, this.cellSize - pad, Color.cyan);
            this.renderer.DrawStrokeBasicRectangle(p1x + pad/2, p1y + pad/2, this.cellSize - pad, this.cellSize - pad, Color.black, 2);
        }

        const p2x = (this.player2.pixelPos) ? (this.player2.pixelPos.x - Math.floor(this.cellSize/2)) : (this.offsetX + this.player2.x * this.cellSize);
        const p2y = (this.player2.pixelPos) ? (this.player2.pixelPos.y - Math.floor(this.cellSize/2)) : (this.offsetY + this.player2.y * this.cellSize);
        if (this.player2.shield) {
            this.renderer.DrawStrokeBasicRectangle(p2x + pad/2 - 2, p2y + pad/2 - 2, this.cellSize - pad + 4, this.cellSize - pad + 4, Color.FromRGB(255,228,0), 3);
        }
        // draw player2 using SSAnimation object if available
        if (this.player2.animObj) {
            const cx2 = (this.player2.pixelPos) ? this.player2.pixelPos.x : (p2x + Math.floor(this.cellSize / 2));
            const cy2 = (this.player2.pixelPos) ? this.player2.pixelPos.y : (p2y + Math.floor(this.cellSize / 2));
            this.player2.animObj.position = new Vector2(cx2, cy2);
            this.player2.animObj.PlayAnimationLoop(this.player2.anim.dir, false);
            if (this.player2.animObj.img && this.player2.animObj.img.complete) {
                this.player2.animObj.Draw(this.renderer);
            }
            else {
                this.renderer.DrawFillBasicRectangle(p2x + pad/2, p2y + pad/2, this.cellSize - pad, this.cellSize - pad, Color.purple);
                this.renderer.DrawStrokeBasicRectangle(p2x + pad/2, p2y + pad/2, this.cellSize - pad, this.cellSize - pad, Color.white, 2);
            }
        }
        else {
            this.renderer.DrawFillBasicRectangle(p2x + pad/2, p2y + pad/2, this.cellSize - pad, this.cellSize - pad, Color.purple);
            this.renderer.DrawStrokeBasicRectangle(p2x + pad/2, p2y + pad/2, this.cellSize - pad, this.cellSize - pad, Color.white, 2);
        }

        // HUD: update HTML header instead of drawing on canvas
        try {
            const el1 = document.getElementById('gameState');
            const el2 = document.getElementById('gamePlayers');

            const assets = window.BombermanAssets || {};
            const uiImages = assets.uiImages || {};
            const bombIcon = assets.uiBomb || null;
            const shieldActive = assets.uiShieldActive || null;
            const shieldInactive = assets.uiShieldInactive || null;

            const buildPlayerHTML = (player, playerColorKey) => {
                const uiImg = uiImages[playerColorKey] || null;
                const uiSrc = (uiImg && uiImg.complete) ? uiImg.src : '';
                const bombSrc = (bombIcon && bombIcon.complete) ? bombIcon.src : '';
                const shieldSrc = (player.shield ? (shieldActive && shieldActive.complete ? shieldActive.src : '') : (shieldInactive && shieldInactive.complete ? shieldInactive.src : ''));

                return `
                    <div style="display:flex; align-items:center; gap:6px;">
                        <div style="display:flex; align-items:center; gap:4px;">
                            <img src="${uiSrc}" style="width:40px;height:40px;object-fit:contain;border-radius:6px;" alt="PUI"/>
                            <div style="font-size:24px; font-weight:600; background:#000; border:3px solid rgb(233,62,0); padding:6px; color:#fff; border-radius:4px; min-width:20px; text-align:center;">${player.lives}</div>
                        </div>
                        <div style="display:flex; align-items:center; gap:4px;">
                            <img src="${bombSrc}" style="width:40px;height:40px;object-fit:contain;" alt="Bomb"/>
                            <div style="font-size:24px; background:#000; border:3px solid rgb(233,62,0); padding:6px; color:#fff; border-radius:4px; min-width:20px; text-align:center;">${Math.max(0, player.maxBombs - player.bombsPlaced)}</div>
                        </div>
                        <div style="display:flex; align-items:center; gap:4px;">
                            <img src="${shieldSrc}" style="width:40px;height:40px;object-fit:contain;" alt="Shield"/>
                        </div>
                    </div>`;
            };

            const p1ColorKey = (assets.playerColorP1) ? assets.playerColorP1 : 'blue';
            const p2ColorKey = (assets.playerColorP2) ? assets.playerColorP2 : 'purple';

            if (el1) el1.innerHTML = buildPlayerHTML(this.player1, p1ColorKey);
            if (el2) el2.innerHTML = buildPlayerHTML(this.player2, p2ColorKey);
        } catch (e) {
            // ignore if DOM not ready or assets not available
        }
    }
}
