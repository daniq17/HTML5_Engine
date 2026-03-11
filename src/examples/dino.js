class DinoGame extends Game {
    constructor(renderer) {
        super(renderer);

        this.groundY = 220;
        this.dino = { x: 60, y: this.groundY, vy: 0, w: 44, h: 44, onGround: true };
        this.gravity = 1800;
        this.jumpVelocity = -650;

        this.obstacles = [];
        this.spawnTimer = 0;
        this.spawnInterval = 1.6;

        this.speed = 260;
        this.speedIncreaseTimer = 0;

        this.score = 0;
        this.scoreLabel = null;

        this.gameOver = false;
    }

    Start() {
        super.Start();
        this.dino.y = this.groundY;
        this.dino.vy = 0;
        this.dino.onGround = true;
        this.obstacles = [];
        this.spawnTimer = 0;
        this.speed = 260;
        this.score = 0;
        this.gameOver = false;
        this.scoreLabel = new TextLabel("0", new Vector2(20, 20), "20px Arial", Color.black, "left", "middle", false);
    }

    Update(deltaTime) {
        super.Update(deltaTime);
        if (this.gameOver) {
            if (Input.IsKeyDown(KEY_ENTER)) this.Start(); // restart
            return;
        }

        // Input: salto
        if ((Input.IsKeyDown(KEY_SPACE) || Input.IsKeyDown(KEY_UP) || Input.IsKeyDown(KEY_W)) && this.dino.onGround) {
            this.dino.vy = this.jumpVelocity;
            this.dino.onGround = false;
        }

        // Física del dino
        this.dino.vy += this.gravity * deltaTime;
        this.dino.y += this.dino.vy * deltaTime;
        if (this.dino.y >= this.groundY) {
            this.dino.y = this.groundY;
            this.dino.vy = 0;
            this.dino.onGround = true;
        }

        // Generar obstáculos
        this.spawnTimer += deltaTime;
        if (this.spawnTimer >= this.spawnInterval) {
            this.spawnTimer = 0;
            const canvasW = this.renderer.canvas ? this.renderer.canvas.width : 800;
            const h = RandomBetweenInt(24, 48);
            this.obstacles.push({ x: canvasW + 20, y: this.groundY + (this.dino.h - h), w: RandomBetweenInt(16, 28), h: h });
        }

        // Mover obstáculos y comprobar colisiones
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const ob = this.obstacles[i];
            ob.x -= this.speed * deltaTime;
            // off-screen -> eliminar y sumar puntos
            if (ob.x + ob.w < 0) {
                this.obstacles.splice(i, 1);
                this.score += 10;
                this.scoreLabel.text = this.score.toString();
                continue;
            }
            // Colisión AABB
            if (this.AABBOverlap(this.dino, ob)) {
                this.gameOver = true;
                this.scoreLabel.text = "Game Over! Score: " + this.score;
            }
        }

        // Aumentar dificultad con el tiempo
        this.speedIncreaseTimer += deltaTime;
        if (this.speedIncreaseTimer >= 5) {
            this.speedIncreaseTimer = 0;
            this.speed += 20;
            if (this.spawnInterval > 0.9) this.spawnInterval -= 0.08;
        }
    }

    AABBOverlap(a, b) {
        const ax1 = a.x, ay1 = a.y - a.h, ax2 = a.x + a.w, ay2 = a.y;
        const bx1 = b.x, by1 = b.y - b.h, bx2 = b.x + b.w, by2 = b.y;
        return !(ax2 < bx1 || ax1 > bx2 || ay2 < by1 || ay1 > by2);
    }

    Draw() {
        super.Draw();
        const ctx = this.renderer;

        const canvasW = this.renderer.canvas ? this.renderer.canvas.width : 800;
        const canvasH = this.renderer.canvas ? this.renderer.canvas.height : 300;

        // Fondo y suelo
        this.renderer.DrawFillBasicRectangle(0, 0, canvasW, canvasH, Color.white);
        this.renderer.DrawFillBasicRectangle(0, this.groundY + 2, canvasW, 6, Color.black);

        // Dino (simple rect — reemplaza con sprite si quieres)
        this.renderer.DrawFillBasicRectangle(this.dino.x, this.dino.y - this.dino.h, this.dino.w, this.dino.h, Color.darkGrey);

        // Obstáculos
        for (const ob of this.obstacles) {
            this.renderer.DrawFillBasicRectangle(ob.x, ob.y - ob.h, ob.w, ob.h, Color.black);
        }

        // Score
        this.scoreLabel.Draw(this.renderer);

        // Si game over, mostrar texto
        if (this.gameOver) {
            const text = new TextLabel("GAME OVER - ENTER to restart", new Vector2(canvasW / 2, canvasH / 2), "18px Arial", Color.black, "center", "middle", false);
            text.Draw(this.renderer);
        }
    }
}