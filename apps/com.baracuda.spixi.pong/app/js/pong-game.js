// Copyright (C) 2025 Baracuda
// Pong Game Module - Audio, physics, collision, and rendering

// ===== AUDIO SYSTEM =====
let audioContext;
let soundEnabled = true;

function initAudioContext() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.warn('Web Audio API not supported');
        soundEnabled = false;
    }
}

function playPaddleHitSound() {
    if (!soundEnabled || !audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 440;
    oscillator.type = 'square';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
}

function playWallBounceSound() {
    if (!soundEnabled || !audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 220;
    oscillator.type = 'square';

    gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.08);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.08);
}

function playScoreSound(isPositive) {
    if (!soundEnabled || !audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    if (isPositive) {
        oscillator.frequency.setValueAtTime(523, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(659, audioContext.currentTime + 0.1);
        oscillator.frequency.setValueAtTime(784, audioContext.currentTime + 0.2);
    } else {
        oscillator.frequency.setValueAtTime(392, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(330, audioContext.currentTime + 0.1);
        oscillator.frequency.setValueAtTime(262, audioContext.currentTime + 0.2);
    }

    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
}

function playGameOverSound(isWinner) {
    if (!soundEnabled || !audioContext) return;

    const notes = isWinner
        ? [523, 659, 784, 1047]
        : [392, 330, 262, 196];

    notes.forEach((freq, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = freq;
        oscillator.type = isWinner ? 'sine' : 'triangle';

        const startTime = audioContext.currentTime + (index * 0.15);
        gainNode.gain.setValueAtTime(0.25, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);

        oscillator.start(startTime);
        oscillator.stop(startTime + 0.3);
    });
}

function playLaunchSound() {
    if (!soundEnabled || !audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.15);
    oscillator.type = 'sawtooth';

    gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.15);
}

// ===== PHYSICS =====

function updateBall(dt) {
    const timeRatio = dt ? (dt / 16.67) : 1.0;

    gameState.ball.x += gameState.ball.vx * timeRatio;
    gameState.ball.y += gameState.ball.vy * timeRatio;

    // Wall collision
    if (gameState.ball.y <= BALL_SIZE / 2 || gameState.ball.y >= CANVAS_HEIGHT - BALL_SIZE / 2) {
        gameState.ball.vy = -gameState.ball.vy;
        gameState.ball.y = Math.max(BALL_SIZE / 2, Math.min(CANVAS_HEIGHT - BALL_SIZE / 2, gameState.ball.y));
        playWallBounceSound();

        if (gameState.hasActiveBallAuthority) {
            sendBallEvent("bounce");
        }
    }
}

function updateBallInterpolation() {
    try {
        if (isNaN(gameState.ball.x) || isNaN(gameState.ball.y) || isNaN(gameState.ball.vx) || isNaN(gameState.ball.vy)) {
            gameState.ball.x = CANVAS_WIDTH / 2;
            gameState.ball.y = CANVAS_HEIGHT / 2;
            gameState.ball.vx = 0;
            gameState.ball.vy = 0;
            return;
        }

        gameState.ball.x += gameState.ball.vx;
        gameState.ball.y += gameState.ball.vy;

        if (gameState.ball.y <= BALL_SIZE / 2 || gameState.ball.y >= CANVAS_HEIGHT - BALL_SIZE / 2) {
            gameState.ball.vy = -gameState.ball.vy;
            gameState.ball.y = Math.max(BALL_SIZE / 2, Math.min(CANVAS_HEIGHT - BALL_SIZE / 2, gameState.ball.y));
            playWallBounceSound();
        }

        if (Math.abs(gameState.ballCorrection.x) > 0.1 || Math.abs(gameState.ballCorrection.y) > 0.1) {
            const correctionX = gameState.ballCorrection.x * BALL_CORRECTION_FACTOR;
            const correctionY = gameState.ballCorrection.y * BALL_CORRECTION_FACTOR;

            gameState.ball.x += correctionX;
            gameState.ball.y += correctionY;

            gameState.ballCorrection.x -= correctionX;
            gameState.ballCorrection.y -= correctionY;
        }
    } catch (e) {
        console.error("Error in updateBallInterpolation:", e);
    }
}

function updateRemotePaddleInterpolation() {
    const currentTime = Date.now();

    if (remotePaddleTarget !== gameState.remotePaddle.y) {
        remotePaddleInterpolating = true;
        remotePaddleLastPosition = gameState.remotePaddle.y;
        remotePaddleLastUpdateTime = currentTime;
    }

    if (remotePaddleInterpolating) {
        gameState.remotePaddle.y += (remotePaddleTarget - gameState.remotePaddle.y) * PADDLE_LERP_FACTOR;

        if (Math.abs(gameState.remotePaddle.y - remotePaddleTarget) < 1) {
            gameState.remotePaddle.y = remotePaddleTarget;
            remotePaddleInterpolating = false;
        }
    }
}

// ===== COLLISION DETECTION =====

function checkCollisions() {
    const rightPaddleX = CANVAS_WIDTH - 20 - PADDLE_WIDTH;
    const leftPaddleX = 20;

    let rightPaddleY, leftPaddleY;
    if (gameState.isBallOwner) {
        rightPaddleY = gameState.localPaddle.y;
        leftPaddleY = gameState.remotePaddle.y;
    } else {
        rightPaddleY = gameState.remotePaddle.y;
        leftPaddleY = gameState.localPaddle.y;
    }

    // Right paddle collision
    if (gameState.ball.x + BALL_SIZE / 2 >= rightPaddleX &&
        gameState.ball.x - BALL_SIZE / 2 <= rightPaddleX + PADDLE_WIDTH &&
        gameState.ball.y >= rightPaddleY &&
        gameState.ball.y <= rightPaddleY + PADDLE_HEIGHT &&
        gameState.ball.vx > 0) {

        gameState.ball.x = rightPaddleX - BALL_SIZE / 2;
        gameState.ball.vx = -gameState.ball.vx;

        const hitPos = (gameState.ball.y - rightPaddleY) / PADDLE_HEIGHT;
        const angleAdjust = (hitPos - 0.5) * 2;
        gameState.ball.vy += angleAdjust * 2;

        const speedBoost = 1 + BALL_SPEED_INCREMENT / Math.abs(gameState.ball.vx);
        gameState.ball.vx *= speedBoost;
        gameState.ball.vy *= speedBoost;

        if (gameState.isBallOwner) {
            gameState.pendingAuthorityTransfer = true;
            playPaddleHitSound();
        }

        recordCollisionEvent();
        sendBallStateWithCollision();
    }

    // Left paddle collision
    if (gameState.ball.x - BALL_SIZE / 2 <= leftPaddleX + PADDLE_WIDTH &&
        gameState.ball.x + BALL_SIZE / 2 >= leftPaddleX &&
        gameState.ball.y >= leftPaddleY &&
        gameState.ball.y <= leftPaddleY + PADDLE_HEIGHT &&
        gameState.ball.vx < 0) {

        gameState.ball.x = leftPaddleX + PADDLE_WIDTH + BALL_SIZE / 2;
        gameState.ball.vx = -gameState.ball.vx;

        const hitPos = (gameState.ball.y - leftPaddleY) / PADDLE_HEIGHT;
        const angleAdjust = (hitPos - 0.5) * 2;
        gameState.ball.vy += angleAdjust * 2;

        const speedBoost = 1 + BALL_SPEED_INCREMENT / Math.abs(gameState.ball.vx);
        gameState.ball.vx *= speedBoost;
        gameState.ball.vy *= speedBoost;

        if (!gameState.isBallOwner) {
            gameState.pendingAuthorityTransfer = true;
            playPaddleHitSound();
        }

        recordCollisionEvent();
        sendBallStateWithCollision();
    }
}

// ===== RENDERING =====

function render() {
    try {
        if (!ctx || !canvas) return;

        ctx.fillStyle = '#1a202c';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Center line
        ctx.strokeStyle = '#4a5568';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        ctx.moveTo(CANVAS_WIDTH / 2, 0);
        ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
        ctx.stroke();
        ctx.setLineDash([]);

        // Connection quality indicator
        if (connectionEstablished && gameState.gameStarted) {
            ctx.save();
            ctx.font = '12px Arial';
            ctx.textAlign = 'right';

            if (connectionQuality === 'good') {
                ctx.fillStyle = '#48bb78';
            } else if (connectionQuality === 'fair') {
                ctx.fillStyle = '#ed8936';
            } else {
                ctx.fillStyle = '#f56565';
            }

            ctx.fillRect(CANVAS_WIDTH - 15, 10, 8, 8);
            ctx.fillText(`${currentPacketRate} pps`, CANVAS_WIDTH - 25, 16);
            ctx.restore();
        }

        // Paddles
        let rightPaddleY, leftPaddleY, rightPaddleColor, leftPaddleColor;

        if (gameState.isBallOwner) {
            rightPaddleY = gameState.localPaddle.y;
            leftPaddleY = gameState.remotePaddle.y;
            rightPaddleColor = '#f56565';
            leftPaddleColor = '#4299e1';
        } else {
            rightPaddleY = gameState.remotePaddle.y;
            leftPaddleY = gameState.localPaddle.y;
            rightPaddleColor = '#f56565';
            leftPaddleColor = '#4299e1';
        }

        const rightPaddleX = CANVAS_WIDTH - 20 - PADDLE_WIDTH;
        const leftPaddleX = 20;

        ctx.fillStyle = rightPaddleColor;
        ctx.fillRect(rightPaddleX, rightPaddleY, PADDLE_WIDTH, PADDLE_HEIGHT);

        ctx.fillStyle = leftPaddleColor;
        ctx.fillRect(leftPaddleX, leftPaddleY, PADDLE_WIDTH, PADDLE_HEIGHT);

        // Ball
        const ballVisible = (Math.abs(gameState.ball.vx) > 0.01 || Math.abs(gameState.ball.vy) > 0.01) ||
            gameState.hasActiveBallAuthority ||
            (gameState.waitingForServe && gameState.isBallOwner);
        if (ballVisible) {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(gameState.ball.x, gameState.ball.y, BALL_SIZE / 2, 0, Math.PI * 2);
            ctx.fill();
        }
    } catch (e) {
        console.error("Error in render:", e);
    }
}

// ===== LIVES DISPLAY =====

function updateLivesDisplay() {
    const localLivesEl = document.getElementById('local-lives');
    const remoteLivesEl = document.getElementById('remote-lives');

    if (localLivesEl && remoteLivesEl) {
        localLivesEl.innerHTML = '❤️'.repeat(gameState.localPaddle.lives);
        remoteLivesEl.innerHTML = '❤️'.repeat(gameState.remotePaddle.lives);
    }
}
