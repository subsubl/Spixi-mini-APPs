// Pong WebAssembly Logic

// Constants
const CANVAS_WIDTH: f64 = 800.0;
const CANVAS_HEIGHT: f64 = 600.0;
const PADDLE_HEIGHT: f64 = 100.0;
const BALL_SIZE: f64 = 12.0;

// Game State Structs
class Ball {
    x: f64;
    y: f64;
    vx: f64;
    vy: f64;
}

class Paddle {
    y: f64;
    lives: i32;
}

// Global State
export const ball: Ball = new Ball();
export const localPaddle: Paddle = new Paddle();
export const remotePaddle: Paddle = new Paddle();

// Initialization
export function init(): void {
    ball.x = CANVAS_WIDTH / 2;
    ball.y = CANVAS_HEIGHT / 2;
    ball.vx = 0;
    ball.vy = 0;

    localPaddle.y = (CANVAS_HEIGHT - PADDLE_HEIGHT) / 2;
    localPaddle.lives = 3;

    remotePaddle.y = (CANVAS_HEIGHT - PADDLE_HEIGHT) / 2;
    remotePaddle.lives = 3;
}

// Update Physics
export function update(dt: f64): void {
    // Move ball
    ball.x += ball.vx; // dt is assumed to be handled by caller or fixed step
    ball.y += ball.vy;

    // Wall collisions
    if (ball.y <= BALL_SIZE / 2 || ball.y >= CANVAS_HEIGHT - BALL_SIZE / 2) {
        ball.vy = -ball.vy;
        // Clamp
        if (ball.y < BALL_SIZE / 2) ball.y = BALL_SIZE / 2;
        if (ball.y > CANVAS_HEIGHT - BALL_SIZE / 2) ball.y = CANVAS_HEIGHT - BALL_SIZE / 2;
    }
}

// Setters for JS interaction
export function setPaddleY(y: f64): void {
    localPaddle.y = y;
}

export function setRemotePaddleY(y: f64): void {
    remotePaddle.y = y;
}

export function setBallState(x: f64, y: f64, vx: f64, vy: f64): void {
    ball.x = x;
    ball.y = y;
    ball.vx = vx;
    ball.vy = vy;
}
