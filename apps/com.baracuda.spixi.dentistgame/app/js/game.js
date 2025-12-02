const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
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
        mode: Phaser.Scale.FIT,
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

function preload() {
    this.load.image('tiles', 'img/tiles.png');
    this.load.image('player', 'img/player.png');
    this.load.image('enemy', 'img/enemy.png');
    this.load.image('collectible', 'img/collectible.png');
}

function create() {
    // Create a simple level procedurally since we don't have a tilemap editor output
    platforms = this.physics.add.staticGroup();

    // Ground
    for (let x = 0; x < 800; x += 32) {
        platforms.create(x + 16, 584, 'tiles').setScale(1).setCrop(0, 0, 32, 32); // Assuming first tile is ground
    }

    // Platforms
    platforms.create(600, 400, 'tiles').setScale(1);
    platforms.create(50, 250, 'tiles').setScale(1);
    platforms.create(750, 220, 'tiles').setScale(1);

    // Player
    player = this.physics.add.sprite(100, 450, 'player');
    player.setBounce(0.2);
    player.setCollideWorldBounds(true);
    player.setScale(0.15); // Scale down the hippo image

    // Enemies
    enemies = this.physics.add.group();
    const enemy = enemies.create(400, 500, 'enemy');
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

    // Score
    scoreText = this.add.text(16, 16, 'Score: 0', { fontSize: '32px', fill: '#000' });

    // Mobile Controls (Simple Touch)
    this.input.addPointer(2);

    // Simple touch zones for left/right/jump
    const leftZone = this.add.zone(0, 0, 300, 600).setOrigin(0).setInteractive();
    const rightZone = this.add.zone(500, 0, 300, 600).setOrigin(0).setInteractive();
    const jumpZone = this.add.zone(0, 0, 800, 600).setOrigin(0).setInteractive(); // Full screen tap for jump logic check

    this.touchLeft = false;
    this.touchRight = false;
    this.touchJump = false;

    leftZone.on('pointerdown', () => this.touchLeft = true);
    leftZone.on('pointerup', () => this.touchLeft = false);

    rightZone.on('pointerdown', () => this.touchRight = true);
    rightZone.on('pointerup', () => this.touchRight = false);

    this.input.on('pointerdown', (pointer) => {
        if (pointer.y < 400) this.touchJump = true;
    });
    this.input.on('pointerup', () => this.touchJump = false);
}

function update() {
    if (gameOver) {
        return;
    }

    if (cursors.left.isDown || this.touchLeft) {
        player.setVelocityX(-160);
        player.flipX = true;
    } else if (cursors.right.isDown || this.touchRight) {
        player.setVelocityX(160);
        player.flipX = false;
    } else {
        player.setVelocityX(0);
    }

    if ((cursors.up.isDown || this.touchJump) && player.body.touching.down) {
        player.setVelocityY(-430);
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
}

function hitEnemy(player, enemy) {
    // If player is falling, they kill the enemy (Mario style)
    if (player.body.velocity.y > 0) {
        enemy.disableBody(true, true);
        player.setVelocityY(-200); // Bounce
        score += 20;
        scoreText.setText('Score: ' + score);
    } else {
        this.physics.pause();
        player.setTint(0xff0000);
        gameOver = true;
        scoreText.setText('Game Over! Score: ' + score);

        // Restart on click
        this.input.on('pointerdown', () => {
            this.scene.restart();
            gameOver = false;
            score = 0;
        });
    }
}
