// --- Configuration ---
const config = {
    type: Phaser.AUTO,
    width: 320,
    height: 240,
    zoom: 3,
    parent: 'game-container',
    backgroundColor: '#1a1a1a',
    pixelArt: true,
    scene: [
        BootScene,
        WaitingRoomScene,
        ReceptionScene,
        HallwayScene,
        Operatory1Scene,
        Operatory2Scene,
        XRayScene,
        SterilizationScene,
        OfficeScene,
        LabScene,
        ClosetScene
    ]
};

const game = new Phaser.Game(config);

// --- Global State ---
const gameState = {
    inventory: [],
    flags: {
        hasKey: false,
        cabinetOpen: false,
        metSecretary: false
    }
};

// --- Core Systems ---

class InteractionManager {
    constructor(scene) {
        this.scene = scene;
        this.scene.input.setDefaultCursor('url(assets/cursor.png), pointer'); // Placeholder
    }

    register(object, description, onClick) {
        object.setInteractive({ useHandCursor: true });

        object.on('pointerover', () => {
            // Highlight effect
            object.setTint(0xdddddd);
        });

        object.on('pointerout', () => {
            object.clearTint();
        });

        object.on('pointerdown', () => {
            if (this.scene.dialogueManager.isTyping) {
                this.scene.dialogueManager.complete();
                return;
            }

            if (onClick) {
                onClick();
            } else {
                this.scene.dialogueManager.show(description);
            }
        });
    }
}

class DialogueManager {
    constructor(scene) {
        this.scene = scene;
        this.isTyping = false;
        this.fullText = '';

        // Text Box Container
        this.container = scene.add.container(10, 180);
        this.container.setScrollFactor(0);
        this.container.setDepth(100);
        this.container.setVisible(false);

        // Background
        const bg = scene.add.rectangle(0, 0, 300, 50, 0x000000, 0.8);
        bg.setOrigin(0);
        bg.setStrokeStyle(1, 0x8a7f70);
        this.container.add(bg);

        // Text Object
        this.textObj = scene.add.text(10, 10, '', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            fill: '#c2b280',
            wordWrap: { width: 280 }
        });
        this.container.add(this.textObj);
    }

    show(text) {
        this.container.setVisible(true);
        this.fullText = text;
        this.textObj.setText('');
        this.isTyping = true;

        let i = 0;
        if (this.timer) this.timer.remove();

        this.timer = this.scene.time.addEvent({
            delay: 30,
            callback: () => {
                this.textObj.text += text[i];
                i++;
                if (i === text.length) {
                    this.isTyping = false;
                }
            },
            repeat: text.length - 1
        });
    }

    complete() {
        if (this.timer) this.timer.remove();
        this.textObj.setText(this.fullText);
        this.isTyping = false;
    }

    hide() {
        this.container.setVisible(false);
    }
}

class InventoryManager {
    constructor(scene) {
        this.scene = scene;
        this.container = scene.add.container(0, 0);
        this.render();
    }

    addItem(item) {
        if (!gameState.inventory.includes(item)) {
            gameState.inventory.push(item);
            this.render();
            // Show notification
            const notif = this.scene.add.text(160, 120, `Picked up: ${item}`, {
                fontFamily: 'Courier New', fontSize: '14px', fill: '#fff', backgroundColor: '#000'
            }).setOrigin(0.5);
            this.scene.time.delayedCall(2000, () => notif.destroy());
        }
    }

    render() {
        this.container.removeAll(true);
        // Simple text list for now
        gameState.inventory.forEach((item, index) => {
            const text = this.scene.add.text(10 + (index * 60), 10, item, {
                fontFamily: 'Courier New', fontSize: '10px', fill: '#fff', backgroundColor: '#333'
            });
            this.container.add(text);
        });
    }
}

// --- Music System (Synth Noir) ---
class MusicManager {
    constructor(scene) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.isPlaying = false;
    }

    start() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.playBassline();
        this.playMelody();
    }

    playBassline() {
        if (!this.isPlaying) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(55, this.ctx.currentTime); // Low A

        // Filter for that muffled noir sound
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(400, this.ctx.currentTime);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 2);

        osc.start();
        osc.stop(this.ctx.currentTime + 2);

        setTimeout(() => this.playBassline(), 4000); // Loop every 4s
    }

    playMelody() {
        if (!this.isPlaying) return;
        // Random eerie high notes
        const notes = [440, 493, 523, 587, 659]; // A minor pentatonic ish
        const note = notes[Math.floor(Math.random() * notes.length)];

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(note, this.ctx.currentTime);

        gain.connect(this.ctx.destination);
        gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.5);

        osc.start();
        osc.stop(this.ctx.currentTime + 1.5);

        setTimeout(() => this.playMelody(), Math.random() * 3000 + 2000);
    }
}

// --- Base Scene (Common Logic) ---
class BaseScene extends Phaser.Scene {
    constructor(key, name) {
        super(key);
        this.roomName = name;
    }

    create() {
        // Managers
        this.dialogueManager = new DialogueManager(this);
        this.interactionManager = new InteractionManager(this);
        this.inventoryManager = new InventoryManager(this);

        // Music (Global check)
        if (!window.musicManager) {
            window.musicManager = new MusicManager(this);
            // Start music on first interaction to comply with browser policies
            this.input.once('pointerdown', () => window.musicManager.start());
        }

        // Common UI
        this.add.text(160, 20, this.roomName, {
            fontFamily: 'Courier New', fontSize: '14px', fill: '#8a7f70', backgroundColor: '#000'
        }).setOrigin(0.5);

        // Navigation Helper
        this.createNavigation();

        // Room Specifics
        this.createRoom();

        // Dialogue Closer
        this.input.on('pointerdown', (pointer, gameObjects) => {
            if (gameObjects.length === 0 && !this.dialogueManager.isTyping) {
                this.dialogueManager.hide();
            }
        });
    }

    createNavigation() {
        // Override in subclasses
    }

    createRoom() {
        // Override in subclasses
    }

    addNavArrow(x, y, direction, targetScene) {
        const arrow = this.add.text(x, y, direction, {
            fontFamily: 'Courier New', fontSize: '20px', fill: '#fff', backgroundColor: '#000'
        }).setOrigin(0.5);

        this.interactionManager.register(arrow, `Go to ${targetScene}`, () => {
            this.scene.start(targetScene);
        });
    }
}

// --- Scenes ---

class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        // Load assets here
        // this.load.image('room_bg', 'assets/room_bg.png');
    }

    create() {
        this.scene.start('WaitingRoomScene');
    }
}

class WaitingRoomScene extends Phaser.Scene {
    constructor() {
        super('WaitingRoomScene');
    }

    create() {
        // Managers
        this.dialogueManager = new DialogueManager(this);
        this.interactionManager = new InteractionManager(this);
        this.inventoryManager = new InventoryManager(this);

        // Background (Placeholder)
        this.add.rectangle(160, 120, 320, 240, 0x2b2b2b);

        // Title
        this.add.text(160, 30, "The Waiting Room", {
            fontFamily: 'Courier New', fontSize: '14px', fill: '#8a7f70'
        }).setOrigin(0.5);

        // Interactable: Secretary's Desk
        const desk = this.add.rectangle(160, 180, 120, 60, 0x4a3b2a);
        this.interactionManager.register(desk, "The secretary's desk. It's piled high with unpaid bills.", () => {
            this.dialogueManager.show("Nobody is here. Just a pile of unpaid bills.");
        });

        // Interactable: Door to Operatory
        const door = this.add.rectangle(280, 140, 40, 100, 0x3a2b1a);
        this.interactionManager.register(door, "The door to the Operatory.", () => {
            if (gameState.flags.metSecretary) {
                // this.scene.start('OperatoryScene');
                this.dialogueManager.show("I can go in now.");
            } else {
                this.dialogueManager.show("I shouldn't go in without announcing myself... if anyone was here.");
            }
        });

        // Interactable: Plant
        const plant = this.add.circle(40, 200, 20, 0x2a4a2a);
        this.interactionManager.register(plant, "A plastic fern. Covered in dust.", () => {
            this.dialogueManager.show("It's fake. And dusty.");
        });

        // Click anywhere to close dialogue
        this.input.on('pointerdown', (pointer, gameObjects) => {
            if (gameObjects.length === 0 && !this.dialogueManager.isTyping) {
                this.dialogueManager.hide();
            }
        });
    }
}

class ReceptionScene extends BaseScene {
    constructor() { super('ReceptionScene', 'Reception Desk'); }
    createRoom() {
        this.add.rectangle(160, 120, 320, 240, 0x332222);
        const book = this.add.rectangle(160, 160, 40, 30, 0xffffff);
        this.interactionManager.register(book, "The Appointment Book.", () => {
            this.dialogueManager.show("Last entry: 'Dr. Plaque - 2:30 PM'. Strange...");
        });
    }
    createNavigation() {
        this.addNavArrow(20, 120, "<", 'WaitingRoomScene');
        this.addNavArrow(300, 120, ">", 'HallwayScene');
    }
}

class HallwayScene extends BaseScene {
    constructor() { super('HallwayScene', 'The Hallway'); }
    createRoom() {
        this.add.rectangle(160, 120, 320, 240, 0x111111);
        this.add.text(60, 100, "OP 1", { fontSize: '10px', fill: '#555' });
        this.add.text(260, 100, "OP 2", { fontSize: '10px', fill: '#555' });
        this.add.text(160, 100, "X-RAY", { fontSize: '10px', fill: '#555' });
    }
    createNavigation() {
        this.addNavArrow(20, 120, "<", 'ReceptionScene');
        this.addNavArrow(60, 160, "^", 'Operatory1Scene');
        this.addNavArrow(260, 160, "^", 'Operatory2Scene');
        this.addNavArrow(160, 160, "^", 'XRayScene');
        this.addNavArrow(300, 120, ">", 'LabScene');
    }
}

class Operatory1Scene extends BaseScene {
    constructor() { super('Operatory1Scene', 'Operatory 1 (Crime Scene)'); }
    createRoom() {
        this.add.rectangle(160, 120, 320, 240, 0x223344);
        const pedestal = this.add.rectangle(160, 140, 40, 60, 0x888888);
        this.interactionManager.register(pedestal, "The display case.", () => {
            this.dialogueManager.show("The Golden Molar is gone! Only a sticky residue remains.");
        });
        const prints = this.add.circle(160, 200, 10, 0x553311);
        this.interactionManager.register(prints, "Muddy footprints.", () => {
            this.dialogueManager.show("Size 12. Work boots. Dr. Plaque wears loafers.");
        });
    }
    createNavigation() {
        this.addNavArrow(160, 220, "v", 'HallwayScene');
    }
}

class Operatory2Scene extends BaseScene {
    constructor() { super('Operatory2Scene', 'Operatory 2 (Construction)'); }
    createRoom() {
        this.add.rectangle(160, 120, 320, 240, 0x444433);
        const screwdriver = this.add.rectangle(200, 180, 20, 5, 0xffff00);
        if (!gameState.inventory.includes('Screwdriver')) {
            this.interactionManager.register(screwdriver, "A screwdriver.", () => {
                this.inventoryManager.addItem('Screwdriver');
                screwdriver.destroy();
                this.dialogueManager.show("Got the Screwdriver.");
            });
        }
    }
    createNavigation() {
        this.addNavArrow(160, 220, "v", 'HallwayScene');
    }
}

class XRayScene extends BaseScene {
    constructor() { super('XRayScene', 'X-Ray Room'); }
    createRoom() {
        this.add.rectangle(160, 120, 320, 240, 0x112211);
        const machine = this.add.rectangle(160, 100, 80, 80, 0xcccccc);
        this.interactionManager.register(machine, "The X-Ray viewer.", () => {
            if (gameState.inventory.includes('X-Ray Film')) {
                this.dialogueManager.show("I placed the film. It shows... a key hidden in a molar!");
                if (!gameState.inventory.includes('Small Key')) {
                    gameState.inventory.push('Small Key');
                    this.inventoryManager.render();
                    this.dialogueManager.show("I found a Small Key taped to the back of the viewer.");
                }
            } else {
                this.dialogueManager.show("It's bright. I need a film to look at.");
            }
        });
    }
    createNavigation() {
        this.addNavArrow(160, 220, "v", 'HallwayScene');
    }
}

class SterilizationScene extends BaseScene {
    constructor() { super('SterilizationScene', 'Sterilization Room'); }
    createRoom() {
        this.add.rectangle(160, 120, 320, 240, 0xffffff);
        const autoclave = this.add.rectangle(160, 140, 60, 40, 0xaaaaaa);
        this.interactionManager.register(autoclave, "The Autoclave. It's stuck.", () => {
            if (gameState.inventory.includes('Screwdriver')) {
                this.dialogueManager.show("I pried it open with the screwdriver.");
                if (!gameState.inventory.includes('Scalpel')) {
                    this.inventoryManager.addItem('Scalpel');
                    this.dialogueManager.show("Found a Scalpel inside.");
                }
            } else {
                this.dialogueManager.show("It's jammed tight. I need a tool to pry it open.");
            }
        });
    }
    createNavigation() {
        this.addNavArrow(20, 120, "<", 'HallwayScene');
    }
}

class OfficeScene extends BaseScene {
    constructor() {
        super('OfficeScene', 'Dr. Decay\\'s Office'); }
    createRoom() {
            this.add.rectangle(160, 120, 320, 240, 0x440000);
            const safe = this.add.rectangle(250, 180, 40, 40, 0x000000);
            this.interactionManager.register(safe, "A wall safe.", () => {
                if (gameState.inventory.includes('Small Key')) {
                    this.dialogueManager.show("The key fits! Inside is... Dr. Plaque's diary? 'I will steal the molar tonight!'");
                } else {
                    this.dialogueManager.show("It's locked.");
                }
            });
            const film = this.add.rectangle(120, 180, 20, 20, 0x333333);
            if(!gameState.inventory.includes('X-Ray Film')) {
            this.interactionManager.register(film, "An X-Ray Film.", () => {
                this.inventoryManager.addItem('X-Ray Film');
                film.destroy();
                this.dialogueManager.show("Picked up the X-Ray Film.");
            });
        }
    }
    createNavigation() {
        this.addNavArrow(20, 120, "<", 'HallwayScene');
    }
}

class LabScene extends BaseScene {
    constructor() { super('LabScene', 'The Lab'); }
    createRoom() {
        this.add.rectangle(160, 120, 320, 240, 0x555555);
        const beaker = this.add.rectangle(160, 160, 20, 30, 0x00ff00);
        this.interactionManager.register(beaker, "Bubbling green liquid.", () => {
            this.dialogueManager.show("Acid. Dangerous.");
            if (!gameState.inventory.includes('Acid')) {
                this.inventoryManager.addItem('Acid');
            }
        });
    }
    createNavigation() {
        this.addNavArrow(20, 120, "<", 'HallwayScene');
        this.addNavArrow(300, 120, ">", 'ClosetScene');
    }
}

class ClosetScene extends BaseScene {
    constructor() { super('ClosetScene', 'Supply Closet'); }
    createRoom() {
        this.add.rectangle(160, 120, 320, 240, 0x221100);
        const plunger = this.add.rectangle(160, 180, 10, 40, 0xff0000);
        this.interactionManager.register(plunger, "A Plunger.", () => {
            this.inventoryManager.addItem('Plunger');
            plunger.destroy();
            this.dialogueManager.show("A heavy-duty plunger.");
        });
        const sink = this.add.rectangle(240, 180, 40, 20, 0xffffff);
        this.interactionManager.register(sink, "A clogged sink.", () => {
            if (gameState.inventory.includes('Plunger')) {
                this.dialogueManager.show("I plunged the sink... and the Golden Molar popped out! Case Closed!");
                this.time.delayedCall(3000, () => {
                    this.scene.start('WaitingRoomScene');
                });
            } else {
                this.dialogueManager.show("It's clogged. Something shiny is stuck down there.");
            }
        });
    }
    createNavigation() {
        this.addNavArrow(20, 120, "<", 'LabScene');
    }
}
