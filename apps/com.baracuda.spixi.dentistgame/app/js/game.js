// =======================================
// Klara's Birthday Mystery - Text Adventure Engine
// A romantic dentist mystery with a twist
// =======================================

// --- Music System (Synth Noir) ---
class MusicManager {
    constructor() {
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
        osc.frequency.setValueAtTime(55, this.ctx.currentTime);
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
        setTimeout(() => this.playBassline(), 4000);
    }

    playMelody() {
        if (!this.isPlaying) return;
        const notes = [440, 493, 523, 587, 659];
        const note = notes[Math.floor(Math.random() * notes.length)];
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(note, this.ctx.currentTime);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.5);
        osc.start();
        osc.stop(this.ctx.currentTime + 1.5);
        setTimeout(() => this.playMelody(), Math.random() * 3000 + 2000);
    }
}

// --- Game State ---
const gameState = {
    inventory: [],
    currentNode: 'start',
    flags: {}
};

// --- Story Database ---
const storyNodes = {
    start: {
        text: `Dear Klara,

On your special birthday, you've been called to investigate the most baffling case of your career. 

You are Klara—brilliant dental detective, solver of impossible mysteries, and tonight, the only person who can recover the legendary Golden Molar.

The artifact, once owned by a Hollywood star, has vanished from Dr. Smile's office. As you enter the dimly lit waiting room, the receptionist is gone. The office is silent except for the soft tick of a clock.

But you notice something—a fresh cup of coffee on the desk, still steaming. Someone was just here...`,
        choices: [
            { label: 'A) Investigate the coffee and desk', next: 'desk' },
            { label: 'B) Search the appointment book', next: 'appointment' },
            { label: 'C) Call out "Hello? Anyone here?"', next: 'callout' },
            { label: 'D) Explore the hallway', next: 'hallway1' }
        ]
    },

    desk: {
        text: `You examine the receptionist's desk closely. The coffee is still warm—whoever was here left moments ago.

Next to the cup, you find a sticky note with elegant handwriting: "She arrives at 8PM. Everything must be perfect. - M.S."

M.S.? Dr. Marcus Smile? But why would he leave notes about your arrival time? How did he know you'd come tonight?

You notice the 'S' in his initials is written with a decorative flourish, almost like a heart...`,
        choices: [
            { label: 'A) Take the sticky note as evidence', next: 'take_note', inventory: 'Sticky Note' },
            { label: 'B) Check the appointment book', next: 'appointment' },
            { label: 'C) Move to the hallway', next: 'hallway1' },
            { label: 'D) Look under the desk', next: 'under_desk' }
        ]
    },

    appointment: {
        text: `You flip open the appointment book. Most entries are routine: cleanings, fillings, root canals.

But the last entry makes your breath catch:

"KLARA - 8:00 PM - SPECIAL CONSULTATION"

Your name. Written in that same elegant script. Each letter of your name is written with care, the 'K' and 'A' especially ornate.

Below it, in smaller text: "Tonight I tell her everything."`,
        choices: [
            { label: 'A) This is strange... continue investigating', next: 'hallway1' },
            { label: 'B) Look for more clues at the desk', next: 'desk' },
            { label: 'C) Check the waiting room magazines', next: 'magazines' },
            { label: 'D) Head directly to Dr. Smile\'s office', next: 'office_early' }
        ]
    },

    callout: {
        text: `"Hello?" your voice echoes through the empty office. "Anyone here?"

Silence. Then... soft music. It's coming from deeper in the office.

Wait—you recognize this song. It's the same melody that's been in your head all week. How strange...`,
        choices: [
            { label: 'A) Follow the music', next: 'follow_music' },
            { label: 'B) Search the desk first', next: 'desk' },
            { label: 'C) Be cautious, explore slowly', next: 'hallway1' },
            { label: 'D) Call out again, louder', next: 'callout2' }
        ]
    },

    hallway1: {
        text: `The hallway stretches before you, doors on either side leading to examination rooms. Framed certificates line the walls—all belonging to Dr. Marcus Smile.

In several photos, you notice he's looking at something off-camera with the most genuine smile. 

The air smells faintly of... roses?`,
        choices: [
            { label: 'A) Check Operatory 1 (Crime Scene)', next: 'operatory1' },
            { label: 'B) Investigate the X-Ray Room', next: 'xray' },
            { label: 'C) Enter Dr. Smile\'s private office', next: 'office' },
            { label: 'D) Follow the scent of roses', next: 'follow_roses' }
        ]
    },

    operatory1: {
        text: `You enter Operatory 1. This is supposed to be the crime scene—where the Golden Molar was displayed.

The glass pedestal is indeed empty, but there's no sign of forced entry. No broken glass. No struggle.

Instead, there's a velvet cloth draped over the pedestal, and on it, a single red rose with a note:

"The first clue to finding what's missing... is knowing what you're really looking for. - M"`,
        choices: [
            { label: 'A) Take the rose', next: 'take_rose', inventory: 'Red Rose' },
            { label: 'B) Read the note more carefully', next: 'note_clue' },
            { label: 'C) Search the room thoroughly', next: 'search_op1' },
            { label: 'D) Leave and check other rooms', next: 'hallway1' }
        ]
    },

    xray: {
        text: `The X-Ray room hums with the quiet buzz of equipment. On the light board, there's an X-ray already mounted.

You step closer. It's an X-ray of teeth, but... wait. One of the molars has been altered. Enhanced. It's shaped like a perfect heart.

Below the X-ray,  another note in that familiar handwriting:

"Klara, some things are invisible to the eye, but clear to the heart. Happy Birthday."`,
        choices: [
            { label: 'A) Take the X-ray', next: 'take_xray', inventory: 'Heart X-Ray' },
            { label: 'B) This is getting suspicious...', next: 'realization1' },
            { label: 'C) Continue investigating other rooms', next: 'hallway1' },
            { label: 'D) Go directly to Dr. Smile\'s office', next: 'office' }
        ]
    },

    office: {
        text: `You push open the door to Dr. Marcus Smile's private office. It's... beautiful. 

The desk is mahogany, there are books about dentistry mixed with poetry collections. On the wall, framed photos—one catches your eye.

It's from the community dental clinic six months ago. You're in the photo. You're laughing, helping a child. And in the corner of the frame, you can see Dr. Smile looking at you with an expression you've never noticed before.

On his desk: his diary, open to today's date.`,
        choices: [
            { label: 'A) Read the diary entry', next: 'diary' },
            { label: 'B) Examine the photograph', next: 'photograph' },
            { label: 'C) Search the desk drawers', next: 'desk_drawer' },
            { label: 'D) This feels too personal... leave', next: 'hallway1' }
        ]
    },

    diary: {
        text: `Your hands tremble slightly as you read:

"Today is Klara's birthday. For months I've tried to find the courage to tell her how I feel. She's brilliant, kind, lights up every room. When she visits the clinic, my whole day changes.

But I'm just a dentist. She's an investigator who solves impossible cases. Why would she notice me?

So I've created an impossible case. The mystery of the Missing Molar. I'll leave clues. Hope she'll find her way to the truth. To the lab. To me.

If whe comes, I'll tell her everything. If she doesn't... at least I tried."`,
        choices: [
            { label: 'A) My hands are shaking... continue to the lab', next: 'lab_approach' },
            { label: 'B) I need a moment to process this', next: 'process' },
            { label: 'C) Check the other rooms first', next: 'hallway1' },
            { label: 'D) Look for more evidence', next: 'desk_drawer' }
        ]
    },

    lab_approach: {
        text: `You walk slowly toward the lab, your heart racing. Each step feels heavier. The clues—the notes, the rose, the heart X-ray—they were never about a theft.

They were about you.

As you reach the lab door, you can see light underneath. Someone is inside.

You take a deep breath. This is it.`,
        choices: [
            { label: 'A) Open the door', next: 'lab_reveal' },
            { label: 'B) Knock first', next: 'lab_knock' },
            { label: 'C) Take a moment to prepare', next: 'prepare' },
            { label: 'D) Turn back (you won\'t actually do this)', next: 'no_turning_back' }
        ]
    },

    lab_reveal: {
        text: `You open the door.

Dr. Marcus Smile stands there, surrounded by candles (battery-powered, safely). In the center of the lab table sits the "missing" Golden Molar, perfectly safe in a velvet display box.

Next to it: a birthday cake with candles that spell "KLARA."

He looks at you, nervous but hopeful, and says:

"Klara, I confess. There was no theft. I created this mystery because... because it's the only way I could think to spend your birthday with you. To tell you that every time you visit, you make the whole office brighter. Every smile you give, I wish I could capture. 

I know I'm just the dentist, and you're the brilliant detective. But tonight, I had to tell you—you've stolen my heart, Klara. Happy Birthday."`,
        choices: [
            { label: 'A) "Marcus, you brilliant fool. Best gift ever."', next: 'ending_romantic' },
            { label: 'B) "This is the most creative confession I\'ve gotten."', next: 'ending_adventure' },
            { label: 'C) "Only if you promise the next mystery involves chocolate."', next: 'ending_sweet' },
            { label: 'D) "Let\'s start with dinner. Then discuss forever."', next: 'ending_practical' }
        ]
    },

    ending_romantic: {
        text: `You step closer, a smile spreading across your face.

"Marcus Smile, you absolute fool," you say, but your eyes are sparkling. "You created an elaborate mystery, left romantic clues, set up candles and cake..."

"I'm sorry, I know it's ridiculous—"

"It's perfect," you interrupt. "No one's ever gone to such lengths for me. No one's ever made me feel like... like I'm worth a grand gesture."

"Klara," he says softly, stepping closer. "You're worth a thousand grand gestures. You're worth mysteries and roses and terrible poetry and... everything."

You're close enough now to see he's trembling slightly.

"Happy Birthday, Klara," he whispers.

"Best birthday ever," you whisper back.

And then, surrounded by candlelight and cake and one very non-stolen Golden Molar, the brilliant detective kisses the romantic dentist.

Some mysteries, you think, have the best solutions.

🎂💕 THE END 💕🎂
(Happy Birthday, Klara!)`,
        choices: []
    },

    ending_adventure: {
        text: `You laugh—a real, genuine laugh that fills the lab.

"Dr. Marcus Smile," you say, shaking your head with wonder. "You created a fake mystery, left cryptic clues, and turned my birthday into an adventure."

He looks uncertain. "Is that... good?"

"Good?" You step forward. "Marcus, do you know how many birthdays I've had where people just give me gift cards? Or worse, dental floss?"

He winces. "I was guilty of that last year."

"Exactly!" You gesture to the elaborate setup. "But this? This is creative. Personal. Fun. You made me a mystery because you know mysteries are my favorite thing."

"Second favorite," he corrects quietly. "Your favorite thing is helping people smile."

You stop. "You noticed that?"

"Klara, I notice everything about you."

You smile—really smile. "Then you probably noticed I've been hoping you'd ask me to dinner for about six months now."

His eyes widen. "You... what?"

"Happy Birthday to me," you say, "and happy day-I-finally-got-asked-out to you. Now, let's eat that cake, Mr. Elaborate Gestures. We have a lot to talk about."

Starting with: more mysteries, please.

🎂🔍 THE END 🔍🎂
(Happy Birthday, Klara!)`,
        choices: []
    },

    ending_sweet: {
        text: `You can't help but smile at his nervous, hopeful expression.

"Okay, Dr. Smile," you say, crossing your arms but unable to hide your grin. "I have one condition."

His face falls slightly. "Anything."

"The next elaborate mystery you create for me—" you hold up a finger, "—has to involve chocolate. Good chocolate. None of this sugar-free dental-approved stuff."

He blinks. Then slowly grins. "So... there'll be a next mystery?"

"Marcus," you say, stepping closer, "you just created a fake crime scene, left romantic notes, and risked looking absolutely ridiculous—all to tell me how you feel on my birthday. Of course there's going to be a next mystery. A next date. A next... everything."

"Even with chocolate involved?"

"Especially with chocolate involved." You pick up the fork from beside the cake. "Now, are you going to help me eat this birthday cake, or do I have to solve the Mystery of the Lone Candle-Eater?"

He laughs—the best sound you've heard all night—and picks up another fork.

"Happy Birthday, Klara," he says.

"Happy Beginning, Marcus," you reply.

And somewhere, the Golden Molar gleams in its case, part of the best birthday present you've ever received: a mystery, a confession, and the start of something wonderful.

🎂🍫 THE END 🍫🎂
(Happy Birthday, Klara!)`,
        choices: []
    },

    ending_practical: {
        text: `You look at the elaborate setup—the candles, the cake, the carefully staged mystery—and then at Marcus's nervous face.

"Okay," you say calmly. "Let's be practical about this."

His face falls slightly. "Oh. Of course. I understand—"

"Marcus." You hold up a hand. "I'm not rejecting you. I'm saying: let's start with dinner. Tomorrow night. Somewhere nice. We can talk about this—" you gesture to all the evidence, "—without the pressure of a grand romantic gesture."

"But I wanted it to be special," he says quietly.

You step forward and take his hand. "It is special. You are special. But Marcus, I don't need mysteries and elaborate setups. What I need is honesty. Time. Real conversation."

"And dinner?" he asks hopefully.

"And dinner," you confirm, smiling. "And then maybe coffee. And then maybe we see where this goes. Because when you wrote 'forever' in your diary... that's not something to decide in one candlelit evening. That's something to discover, step by step."

He looks at you with such warmth. "You're brilliant, you know that?"

"I'm a detective. I'm practical." You squeeze his hand. "But I'm also intrigued. Very intrigued. By you, Dr. Smile."

"Marcus," he says. "Please, call me Marcus."

"Okay, Marcus." You pick up a piece of cake. "Now, before we discuss forever... let's start with eating this cake and celebrating my birthday. Together."

"Together," he echoes, and his smile could light up the whole office.

Some love stories start with grand gestures. Others start practical, and build into something extraordinary.

Yours? Might just be both.

🎂💕 THE END 💕🎂
(Happy Birthday, Klara!)`,
        choices: []
    }
};

// Shortcuts for other nodes...
storyNodes.take_note = { text: `You carefully place the note in your evidence bag. Something about this whole situation is becoming less sinister and more... mysterious in a different way.`, choices: [{ label: 'A) Continue investigating', next: 'hallway1' }] };
storyNodes.take_rose = { text: `You pick up the rose. It's real, fresh. Someone went to a florist today. For a "crime scene"?`, choices: [{ label: 'A) This is unusual...', next: 'hallway1' }] };
storyNodes.take_xray = {
    text: `You take the heart-shaped X-ray. This is definitely not standard dental imaging.`, choices: [{
        label: 'A) Something's going on here', next: 'realization1' }] };
storyNodes.realization1 = { text: `You pause, evidence in hand. A rose. A heart. Birthday wishes. These aren't clues to a theft. These are... clues to something else entirely.`, choices: [{ label: 'A) I need to find Dr. Smile', next: 'office' }, { label: 'B) Check the lab', next: 'lab_approach' }] };
        storyNodes.lab_knock = { text: `You knock. "Come in, Klara," says a familiar voice. He was waiting for you.`, choices: [{ label: 'A) Enter', next: 'lab_reveal' }] };

        // --- Game Engine ---
        class GameEngine {
        constructor() {
            this.storyText = document.getElementById('story-text');
            this.choiceButtons = [
                document.getElementById('choice-a'),
                document.getElementById('choice-b'),
                document.getElementById('choice-c'),
                document.getElementById('choice-d')
            ];
            this.inventoryList = document.getElementById('inventory-list');

            this.choiceButtons.forEach((btn, index) => {
                btn.addEventListener('click', () => this.makeChoice(index));
            });

            this.musicManager = new MusicManager();
            document.addEventListener('click', () => this.musicManager.start(), { once: true });
        }

    start() {
            this.displayNode(gameState.currentNode);
        }

    displayNode(nodeId) {
            const node = storyNodes[nodeId];
            if (!node) {
                console.error('Node not found:', nodeId);
                return;
            }

            gameState.currentNode = nodeId;

            // Display story text with typewriter effect
            this.storyText.innerHTML = '';
            this.typeWriter(node.text, 0);

            // Display choices or hide if ending
            if (node.choices.length === 0) {
                this.choiceButtons.forEach(btn => btn.style.display = 'none');
            } else {
                node.choices.forEach((choice, index) => {
                    if (this.choiceButtons[index]) {
                        this.choiceButtons[index].textContent = choice.label;
                        this.choiceButtons[index].style.display = 'block';
                        this.choiceButtons[index].disabled = false;
                    }
                });
                // Hide unused buttons
                for (let i = node.choices.length; i < 4; i++) {
                    this.choiceButtons[i].style.display = 'none';
                }
            }
            if (!choice) return;

            // Add to inventory if specified
            if (choice.inventory && !gameState.inventory.includes(choice.inventory)) {
                gameState.inventory.push(choice.inventory);
            }

            // Disable buttons during transition
            this.choiceButtons.forEach(btn => btn.disabled = true);

            // Navigate to next node
            setTimeout(() => {
                this.displayNode(choice.next);
            }, 300);
        }

    updateInventory() {
            if (gameState.inventory.length === 0) {
                this.inventoryList.textContent = 'None yet';
            } else {
                this.inventoryList.textContent = gameState.inventory.join(', ');
            }
        }
    }

// --- Start Game ---
window.addEventListener('DOMContentLoaded', () => {
        const game = new GameEngine();
        game.start();
    });
