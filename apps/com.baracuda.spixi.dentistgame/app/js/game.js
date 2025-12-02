const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: 'game-container',
    backgroundColor: '#87CEEB',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 600 },
            debug: false
        }
    },
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);

let player;
let cursors;
let platforms;
let enemies;
let collectibles;
let score = 0;
let scoreText;
let gameOver = false;
let soundManager;

// --- Audio System (Procedural 8-bit Sounds) ---
class SoundManager {
    constructor(scene) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3; // Lower volume
        this.masterGain.connect(this.ctx.destination);
    }

    playTone(freq, type, duration) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playJump() {
        this.playTone(400, 'square', 0.1);
        setTimeout(() => this.playTone(600, 'square', 0.2), 50);
    }

    playCollect() {
        this.playTone(1000, 'sine', 0.1);
        setTimeout(() => this.playTone(1500, 'sine', 0.2), 50);
    }

    playAttack() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(50, this.ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    }

    playHit() {
        this.playTone(150, 'sawtooth', 0.3);
    }
}

function preload() {
    this.load.image('tiles', 'img/tiles.png');
    this.load.image('player', 'img/player.png');
    this.load.image('enemy', 'img/enemy.png');
    this.load.image('collectible', 'img/collectible.png');
}

function create() {
    soundManager = new SoundManager(this);

    // Dynamic World Bounds based on screen size, but keep minimum playable area
    const worldWidth = Math.max(window.innerWidth, 800);
    const worldHeight = Math.max(window.innerHeight, 600);
    this.physics.world.setBounds(0, 0, worldWidth, worldHeight);

    // Create a simple level procedurally
    platforms = this.physics.add.staticGroup();

    // Ground (spanning the whole world width)
    for (let x = 0; x < worldWidth; x += 32) {
        platforms.create(x + 16, worldHeight - 16, 'tiles').setScale(1).setCrop(0, 0, 32, 32);
    }

    // Platforms (Relative positions)
    platforms.create(worldWidth * 0.75, worldHeight * 0.66, 'tiles').setScale(1);
    platforms.create(worldWidth * 0.1, worldHeight * 0.4, 'tiles').setScale(1);
    platforms.create(worldWidth * 0.9, worldHeight * 0.35, 'tiles').setScale(1);

    // Player
    player = this.physics.add.sprite(100, worldHeight - 100, 'player');
    player.setBounce(0.2);
    player.setCollideWorldBounds(true);
    player.setScale(0.15);
    player.isAttacking = false;

    // Camera
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.startFollow(player, true, 0.05, 0.05);

    // Enemies
    enemies = this.physics.add.group();
    const enemy = enemies.create(worldWidth * 0.5, worldHeight - 100, 'enemy');
    enemy.setBounce(1);
    enemy.setCollideWorldBounds(true);
    enemy.setVelocityX(100);
    enemy.setScale(0.1);

    // Collectibles
    collectibles = this.physics.add.group({
        key: 'collectible',
        repeat: 5,
        setXY: { x: 12, y: 0, stepX: 140 }
    });

    collectibles.children.iterate(function (child) {
        child.setBounceY(Phaser.Math.FloatBetween(0.4, 0.8));
        child.setScale(0.1);
    });

    // Colliders
    this.physics.add.collider(player, platforms);
    this.physics.add.collider(enemies, platforms);
    this.physics.add.collider(collectibles, platforms);

    // Overlaps
    this.physics.add.overlap(player, collectibles, collectItem, null, this);
    this.physics.add.collider(player, enemies, hitEnemy, null, this);

    // Input
    cursors = this.input.keyboard.createCursorKeys();
    this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);

    // Score
    scoreText = this.add.text(16, 16, 'Score: 0', { fontSize: '32px', fill: '#000' });

    // Initialize DOOM-style Joystick
    initJoystick();
}

function update() {
    if (gameOver) {
        return;
    }

    // Player Movement (Joystick simulates Arrow Keys)
    if (cursors.left.isDown) {
        player.setVelocityX(-160);
        player.flipX = true;
    } else if (cursors.right.isDown) {
        player.setVelocityX(160);
        player.flipX = false;
    } else {
        player.setVelocityX(0);
    }

    // Jump (Up Arrow or Space or Ctrl/Fire)
    const isJumpDown = cursors.up.isDown ||
        this.input.keyboard.checkDown(this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL));

    if (isJumpDown && player.body.touching.down) {
        player.setVelocityY(-430);
        soundManager.playJump();
    }

    // Attack (Space or USE button)
    const isAttackDown = this.input.keyboard.checkDown(this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE));

    if (isAttackDown && !player.isAttacking) {
        player.isAttacking = true;
        soundManager.playAttack();

        // Visual feedback (simple tint for now, later animation)
        player.setTint(0x00ff00);

        // Create a temporary hitbox for the attack
        const attackHitbox = this.add.zone(player.x + (player.flipX ? -30 : 30), player.y, 40, 40);
        this.physics.add.existing(attackHitbox);

        this.physics.add.overlap(attackHitbox, enemies, (hitbox, enemy) => {
            enemy.disableBody(true, true);
            score += 50; // Bonus for melee kill
            scoreText.setText('Score: ' + score);
            soundManager.playHit();
        });

        // Reset attack after duration
        setTimeout(() => {
            player.isAttacking = false;
            player.clearTint();
            attackHitbox.destroy();
        }, 200);
    }

    // Simple Enemy Patrol
    enemies.children.iterate(function (child) {
        if (child.body.blocked.left) {
            child.setVelocityX(100);
        } else if (child.body.blocked.right) {
            child.setVelocityX(-100);
        }
    });
}

function collectItem(player, collectible) {
    collectible.disableBody(true, true);
    score += 10;
    scoreText.setText('Score: ' + score);
    soundManager.playCollect();
}

function hitEnemy(player, enemy) {
    // If player is falling, they kill the enemy (Mario style)
    if (player.body.velocity.y > 0) {
        enemy.disableBody(true, true);
        player.setVelocityY(-200); // Bounce
        score += 20;
        scoreText.setText('Score: ' + score);
        soundManager.playHit();
    } else {
        this.physics.pause();
        player.setTint(0xff0000);
        gameOver = true;
        scoreText.setText('Game Over! Score: ' + score);
        soundManager.playHit();

        // Restart on click
        this.input.on('pointerdown', () => {
            this.scene.restart();
            gameOver = false;
            score = 0;
        });
    }
}

// --- Joystick & Controls Implementation ---

function initJoystick() {
    console.log('Initializing Joystick...');
    const joystick = new Joystick('joystick-container', 'joystick-knob');

    // Setup Exit Button
    const exitBtn = document.getElementById('btn-quit');
    if (exitBtn) {
        const newExitBtn = exitBtn.cloneNode(true);
        exitBtn.parentNode.replaceChild(newExitBtn, exitBtn);
        const handleExit = (e) => {
            e.preventDefault();
            e.stopPropagation();
            try { SpixiAppSdk.back(); } catch (e) { console.error(e); }
        };
        newExitBtn.addEventListener('click', handleExit);
        newExitBtn.addEventListener('touchstart', handleExit);
    }

    // Setup Action Buttons (Simulate Keys)
    document.querySelectorAll('.action-btn[data-key]').forEach(btn => {
        const key = btn.getAttribute('data-key');
        const simulate = (pressed) => {
            const eventType = pressed ? 'keydown' : 'keyup';
            let keyCode;

            // Map keys to Phaser-friendly codes if needed
            if (key === 'ArrowUp') keyCode = 38;
            else if (key === 'ArrowDown') keyCode = 40;
            else if (key === 'ArrowLeft') keyCode = 37;
            else if (key === 'ArrowRight') keyCode = 39;
            else if (key === ' ') keyCode = 32;
            else if (key === 'Control') keyCode = 17;
            else if (key === 'Escape') keyCode = 27;
            else if (key === 'Enter') keyCode = 13;
            else keyCode = key.toUpperCase().charCodeAt(0);

            window.dispatchEvent(new KeyboardEvent(eventType, {
                key: key,
                code: key === ' ' ? 'Space' : key,
                keyCode: keyCode,
                which: keyCode,
                bubbles: true
            }));
        };

        btn.addEventListener('mousedown', (e) => { e.preventDefault(); simulate(true); btn.classList.add('active'); });
        btn.addEventListener('mouseup', (e) => { e.preventDefault(); simulate(false); btn.classList.remove('active'); });
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); simulate(true); btn.classList.add('active'); });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); simulate(false); btn.classList.remove('active'); });
    });
}

class Joystick {
    constructor(containerId, knobId, options = {}) {
        this.container = document.getElementById(containerId);
        this.knob = document.getElementById(knobId);
        this.options = Object.assign({
            maxDistance: 50,
            deadZone: 10
        }, options);

        this.active = false;
        this.startPos = { x: 0, y: 0 };
        this.keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

        if (this.container && this.knob) {
            this.initEvents();
        } else {
            console.error('Joystick elements not found');
        }
    }

    initEvents() {
        this.container.addEventListener('touchstart', this.handleStart.bind(this), { passive: false });
        this.container.addEventListener('touchmove', this.handleMove.bind(this), { passive: false });
        this.container.addEventListener('touchend', this.handleEnd.bind(this));
        this.container.addEventListener('touchcancel', this.handleEnd.bind(this));
        this.container.addEventListener('mousedown', this.handleStart.bind(this));
        document.addEventListener('mousemove', this.handleMove.bind(this));
        document.addEventListener('mouseup', this.handleEnd.bind(this));
    }

    handleStart(e) {
        if (e.type === 'mousedown') {
            this.active = true;
            this.startPos = { x: e.clientX, y: e.clientY };
        } else {
            this.active = true;
            this.startPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        this.updateKnob(0, 0);
    }

    handleMove(e) {
        if (!this.active) return;
        if (e.cancelable) e.preventDefault();

        let clientX, clientY;
        if (e.type === 'mousemove') {
            clientX = e.clientX;
            clientY = e.clientY;
        } else {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }

        const dx = clientX - this.startPos.x;
        const dy = clientY - this.startPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        let moveX = dx;
        let moveY = dy;

        if (distance > this.options.maxDistance) {
            const ratio = this.options.maxDistance / distance;
            moveX = dx * ratio;
            moveY = dy * ratio;
        }

        this.updateKnob(moveX, moveY);
        this.updateKeys(moveX, moveY, distance);
    }

    handleEnd() {
        if (!this.active) return;
        this.active = false;
        this.updateKnob(0, 0);
        this.resetKeys();
    }

    updateKnob(x, y) {
        this.knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    }

    updateKeys(x, y, distance) {
        if (distance < this.options.deadZone) {
            this.resetKeys();
            return;
        }

        const angle = Math.atan2(y, x) * 180 / Math.PI;
        const newKeys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

        if (angle > -135 && angle < -45) newKeys.ArrowUp = true;
        if (angle > 45 && angle < 135) newKeys.ArrowDown = true;
        if (angle > 135 || angle < -135) newKeys.ArrowLeft = true;
        if (angle > -45 && angle < 45) newKeys.ArrowRight = true;

        this.triggerKeyChanges(newKeys);
    }

    resetKeys() {
        this.triggerKeyChanges({ ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false });
    }

    triggerKeyChanges(newKeys) {
        for (const key in newKeys) {
            if (newKeys[key] !== this.keys[key]) {
                this.keys[key] = newKeys[key];
                this.simulateKey(key, newKeys[key]);
            }
        }
    }

    simulateKey(key, pressed) {
        const eventType = pressed ? 'keydown' : 'keyup';
        const keyCodeMap = { 'ArrowUp': 38, 'ArrowDown': 40, 'ArrowLeft': 37, 'ArrowRight': 39 };
        const keyCode = keyCodeMap[key];

        window.dispatchEvent(new KeyboardEvent(eventType, {
            key: key,
            code: key,
            keyCode: keyCode,
            which: keyCode,
            bubbles: true
        }));
    }
}
