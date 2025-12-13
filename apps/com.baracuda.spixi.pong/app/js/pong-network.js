// Copyright (C) 2025 Baracuda
// Pong Network Module - Binary protocol, time sync, and network communication

// ===== GAME CONSTANTS (shared) =====
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PADDLE_WIDTH = 15;
const PADDLE_HEIGHT = 100;
const BALL_SIZE = 12;
const PADDLE_SPEED = 8;
const BALL_SPEED_INITIAL = 7;
const BALL_SPEED_INCREMENT = 0.4;
const MAX_LIVES = 3;
const FRAME_RATE = 60;

// Dynamic network rate variables
let currentNetworkRate = 33;
const NETWORK_RATE_ACTIVE = 100;
const NETWORK_RATE_IDLE = 100;
const NETWORK_RATE_THROTTLED = 66;

// ===== BINARY PROTOCOL =====
// Message type constants
const MSG_STATE = 1;
const MSG_COLLISION = 2;
const MSG_LAUNCH = 3;
const MSG_LIVES = 4;
const MSG_END = 5;
const MSG_PING = 6;
const MSG_PONG = 7;
const MSG_CONNECT = 8;
const MSG_CRIT_ACK = 9;
const MSG_BOUNCE = 10;
const MSG_FULL_RESET = 11;
const MSG_EXIT = 12;
const MSG_RESTART = 13;
const MSG_PADDLE = 14;
const MSG_CHAT = 15;
const MSG_STATUS = 16;

// Enable/disable binary protocol (for gradual rollout)
let useBinaryProtocol = true;

// ===== CLOCK SYNCHRONIZATION =====
class TimeSync {
    constructor() {
        this.offset = 0;
        this.rtt = 0;
        this.samples = [];
    }

    sendPing() {
        try {
            const now = Date.now();
            SpixiAppSdk.sendNetworkData(JSON.stringify({
                a: "ping",
                t: now
            }));
        } catch (e) {
            console.error("Error sending ping:", e);
        }
    }

    handlePong(msg) {
        const now = Date.now();
        const rtt = now - msg.origT;
        this.rtt = rtt;
        const offset = (msg.t + rtt / 2) - now;
        this.samples.push(offset);
        if (this.samples.length > 5) this.samples.shift();
        this.offset = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    }

    handlePing(msg) {
        try {
            SpixiAppSdk.sendNetworkData(JSON.stringify({
                a: "pong",
                origT: msg.t,
                t: Date.now()
            }));
        } catch (e) {
            console.error("Error sending pong:", e);
        }
    }

    getSyncedTime() {
        return Date.now() + this.offset;
    }
}

const timeSync = new TimeSync();
let syncInterval;

// ===== BINARY ENCODERS =====

/**
 * Encode a state packet to binary format
 * Layout: [type:1][frame:2][paddleY:2][seq:2][lastAck:2][ballX:2][ballY:2][ballVx:2][ballVy:2] = 17 bytes
 */
function encodeStatePacket(frame, paddleY, seq, lastAck, ball) {
    const buffer = new ArrayBuffer(17);
    const view = new DataView(buffer);
    view.setUint8(0, MSG_STATE);
    view.setUint16(1, frame & 0xFFFF, true);
    view.setUint16(3, Math.round(paddleY) & 0xFFFF, true);
    view.setUint16(5, seq & 0xFFFF, true);
    view.setUint16(7, lastAck & 0xFFFF, true);
    if (ball) {
        view.setUint16(9, Math.round(ball.x) & 0xFFFF, true);
        view.setUint16(11, Math.round(ball.y) & 0xFFFF, true);
        view.setInt16(13, Math.round(ball.vx * 100), true);
        view.setInt16(15, Math.round(ball.vy * 100), true);
    }
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/**
 * Encode a paddle update packet (compact)
 * Layout: [type:1][paddleY:2][seq:2] = 5 bytes
 */
function encodePaddlePacket(paddleY, seq) {
    const buffer = new ArrayBuffer(5);
    const view = new DataView(buffer);
    view.setUint8(0, MSG_PADDLE);
    view.setUint16(1, Math.round(paddleY) & 0xFFFF, true);
    view.setUint16(3, seq & 0xFFFF, true);
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/**
 * Encode a ball event packet
 * Layout: [type:1][timestamp:4][x:2][y:2][vx:2][vy:2] = 13 bytes
 */
function encodeBallEventPacket(type, timestamp, ball) {
    const buffer = new ArrayBuffer(13);
    const view = new DataView(buffer);
    view.setUint8(0, type);
    view.setUint32(1, timestamp & 0xFFFFFFFF, true);
    view.setUint16(5, Math.round(ball.x) & 0xFFFF, true);
    view.setUint16(7, Math.round(ball.y) & 0xFFFF, true);
    view.setInt16(9, Math.round(ball.vx * 100), true);
    view.setInt16(11, Math.round(ball.vy * 100), true);
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/**
 * Encode a simple packet (ping, pong, connect, etc.)
 * Layout: [type:1][data:4] = 5 bytes
 */
function encodeSimplePacket(type, data) {
    const buffer = new ArrayBuffer(5);
    const view = new DataView(buffer);
    view.setUint8(0, type);
    view.setUint32(1, data & 0xFFFFFFFF, true);
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

// ===== BINARY DECODER =====

/**
 * Decode a binary packet from base64
 */
function decodeBinaryPacket(base64) {
    try {
        const binary = atob(base64);
        const buffer = new ArrayBuffer(binary.length);
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const view = new DataView(buffer);

        const type = view.getUint8(0);
        const result = { type };

        if (type === MSG_STATE && binary.length >= 17) {
            result.frame = view.getUint16(1, true);
            result.paddleY = view.getUint16(3, true);
            result.seq = view.getUint16(5, true);
            result.lastAck = view.getUint16(7, true);
            result.ballX = view.getUint16(9, true);
            result.ballY = view.getUint16(11, true);
            result.ballVx = view.getInt16(13, true) / 100;
            result.ballVy = view.getInt16(15, true) / 100;
        } else if ((type === MSG_LAUNCH || type === MSG_BOUNCE || type === MSG_COLLISION) && binary.length >= 13) {
            result.timestamp = view.getUint32(1, true);
            result.ballX = view.getUint16(5, true);
            result.ballY = view.getUint16(7, true);
            result.ballVx = view.getInt16(9, true) / 100;
            result.ballVy = view.getInt16(11, true) / 100;
        } else if (type === MSG_PADDLE && binary.length >= 5) {
            result.paddleY = view.getUint16(1, true);
            result.seq = view.getUint16(3, true);
        } else if (type === MSG_CHAT && binary.length >= 3) {
            const textLen = view.getUint16(1, true);
            const textBytes = bytes.slice(3, 3 + textLen);
            result.text = new TextDecoder().decode(textBytes);
        } else if (type === MSG_STATUS && binary.length >= 2) {
            result.status = view.getUint8(1);
        } else if ((type === MSG_LIVES || type === MSG_END) && binary.length >= 3) {
            result.local = view.getUint8(1);
            result.remote = view.getUint8(2);
        } else if (binary.length >= 5) {
            result.data = view.getUint32(1, true);
        }

        return result;
    } catch (e) {
        return null;
    }
}

/**
 * Check if data is a binary packet
 */
function isBinaryPacket(data) {
    if (!data || data.length < 4) return false;
    return data[0] !== '{' && data[0] !== '[';
}
