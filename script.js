const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('high-score');
const finalScoreEl = document.getElementById('final-score');
const statusBar = document.getElementById('status-bar');

const initialsContainer = document.getElementById('initials-container');
const initialsInput = document.getElementById('initials-input');
const saveScoreBtn = document.getElementById('save-score-btn');
const leaderboardList = document.getElementById('leaderboard-list');
const downloadBtn = document.getElementById('download-btn');

const startOverlay = document.getElementById('start-overlay');
const pauseOverlay = document.getElementById('pause-overlay');
const gameOverOverlay = document.getElementById('game-over-overlay');
const flashOverlay = document.getElementById('flash-overlay');

const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');

// Grid and Cell sizes
const GRID_SIZE = 20; // 20x20 grid
const GRID_COUNT = GRID_SIZE;
let CELL_SIZE;

// Game State Enum
const GameState = {
    START: 0,
    PLAYING: 1,
    PAUSED: 2,
    GAME_OVER: 3
};

// Item Types
const ItemType = {
    APPLE: { color: '#ff3366', glow: 'rgba(255, 51, 102, 0.8)', name: 'Apple', points: 10 },
    SPEED: { color: '#00ffff', glow: 'rgba(0, 255, 255, 0.8)', name: 'Speed Up', duration: 15000 },
    SLOW: { color: '#ff00ff', glow: 'rgba(255, 0, 255, 0.8)', name: 'Slow Down', duration: 15000 },
    INVINCIBLE: { color: '#ffff00', glow: 'rgba(255, 255, 0, 0.8)', name: 'Invincible', duration: 15000 },
    LASER: { color: '#ff4500', glow: 'rgba(255, 69, 0, 0.8)', name: 'Laser Beam', duration: 15000 }
};

// Colors
const SNAKE_HEAD_COLOR = '#44ff44';
const SNAKE_BODY_COLOR = '#228b22';
const SNAKE_GLOW = 'rgba(68, 255, 68, 0.6)';

const INVINCIBLE_HEAD_COLOR = '#ffff00';
const INVINCIBLE_BODY_COLOR = '#bbbb00';

// Global Variables
let currentState = GameState.START;
let snake = [];
let direction = { x: 1, y: 0 };
let nextDirection = { x: 1, y: 0 };
let items = [];
let score = 0;
let highScore = 0;
let latestLeaderboard = []; // Store the data internally when firebase updates

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDuV_3pGgeeAmu-xMlH4z9y-CU_qhiIJEo",
    authDomain: "supersnake-e2f12.firebaseapp.com",
    projectId: "supersnake-e2f12",
    storageBucket: "supersnake-e2f12.firebasestorage.app",
    messagingSenderId: "77847004270",
    measurementId: "G-2QH0B78FFJ",
    databaseURL: "https://supersnake-4d528-default-rtdb.firebaseio.com/"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const leaderboardRef = database.ref('leaderboard');

// Listen for leaderboard updates
leaderboardRef.orderByChild('score').limitToLast(10).on('value', (snapshot) => {
    latestLeaderboard = [];
    snapshot.forEach((childSnapshot) => {
        latestLeaderboard.push(childSnapshot.val());
    });
    // Reverse because Firebase sorts ascending
    latestLeaderboard.reverse();

    // Update local high score based on the highest score in the global db (optional, or we can keep it strictly local)
    // Actually, let's keep personal high score in local storage, and global leaderboard via Firebase
    let localHigh = localStorage.getItem('supersnake_personal_high') || 0;
    highScore = Math.max(localHigh, score);
    highScoreEl.innerText = highScore;

    displayLeaderboard();
});

// Laser
let laserActive = false;
let laserBeam = null; // { x1, y1, x2, y2, time }

// Timing
let lastTime = 0;
let accumulator = 0;
let moveInterval = 180; // ms per movement step
let baseMoveInterval = 180;

// Active Powerups (supports multiple simultaneous)
let activePowerups = new Map(); // Map<ItemType, remainingMs>

// Initialization
function resizeCanvas() {
    const containerWidth = document.getElementById('canvas-container').clientWidth;
    // Set logical size equal to actual grid * some multiplier to stay sharp 
    canvas.width = 800; // Fixed logical size for internal drawing
    canvas.height = 800;
    CELL_SIZE = canvas.width / GRID_SIZE;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function resetGame() {
    snake = [
        { x: 5, y: 10 },
        { x: 4, y: 10 },
        { x: 3, y: 10 }
    ];
    direction = { x: 1, y: 0 };
    nextDirection = { x: 1, y: 0 };
    score = 0;
    scoreEl.innerText = score;
    items = [];
    spawnItem(ItemType.APPLE);
    moveInterval = baseMoveInterval;
    activePowerups.clear();
    currentState = GameState.PLAYING;
    startOverlay.classList.add('hidden');
    gameOverOverlay.classList.add('hidden');
    pauseOverlay.classList.add('hidden');

    startBtn.blur();
    restartBtn.blur();

    lastTime = performance.now();
    accumulator = 0;
    requestAnimationFrame(gameLoop);
}

// Input Handling
window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();

    // Prevent default common keys
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'p'].includes(key)) {
        event.preventDefault();
    }

    if (key === 'p') {
        togglePause();
        return;
    }

    if (key === ' ') {
        if (activePowerups.has(ItemType.LASER)) {
            fireLaser();
        }
        return;
    }

    if (currentState === GameState.PAUSED) {
        if (event.key.toLowerCase() === 'p') {
            togglePause();
        }
        return;
    }

    if (currentState === GameState.PLAYING) {
        let newDir = { x: direction.x, y: direction.y };
        if ((key === 'arrowup' || key === 'w') && direction.y !== 1) newDir = { x: 0, y: -1 };
        else if ((key === 'arrowdown' || key === 's') && direction.y !== -1) newDir = { x: 0, y: 1 };
        else if ((key === 'arrowleft' || key === 'a') && direction.x !== 1) newDir = { x: -1, y: 0 };
        else if ((key === 'arrowright' || key === 'd') && direction.x !== -1) newDir = { x: 1, y: 0 };

        // Prevent 180 degree turns on next frame
        if (newDir.x !== nextDirection.x || newDir.y !== nextDirection.y) {
            nextDirection = newDir;
        }
    } else if (currentState === GameState.PAUSED) {
        if (event.code === 'Space') {
            currentState = GameState.PLAYING;
            pauseOverlay.classList.add('hidden');
            lastTime = performance.now();
            requestAnimationFrame(gameLoop);
        }
    }
});

startBtn.addEventListener('click', resetGame);
restartBtn.addEventListener('click', resetGame);

saveScoreBtn.addEventListener('click', () => {
    const initials = initialsInput.value.toUpperCase() || '???';
    const entry = { initials, score, timestamp: Date.now() };

    // Push new score to Firebase
    leaderboardRef.push(entry).then(() => {
        initialsContainer.classList.add('hidden');
    }).catch(err => {
        console.error("Error saving score:", err);
        initialsContainer.classList.add('hidden');
    });
});

downloadBtn.addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(latestLeaderboard, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "supersnake_global_scores.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
});

function displayLeaderboard() {
    leaderboardList.innerHTML = '';
    latestLeaderboard.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'leaderboard-entry';
        div.innerHTML = `<span>${entry.initials}</span> <span>${entry.score}</span>`;
        leaderboardList.appendChild(div);
    });
}

function fireLaser() {
    const head = snake[0];
    const dx = direction.x;
    const dy = direction.y;

    // Define beam path
    let x2, y2;
    // Define beam path and start slightly ahead of the center so it doesn't cover the head
    let x1 = head.x;
    let y1 = head.y;
    if (dx !== 0) {
        x1 += dx * 0.5; // Offset start
        x2 = dx > 0 ? GRID_COUNT - 1 : 0;
        y2 = y1;
    } else {
        y1 += dy * 0.5; // Offset start
        x2 = x1;
        y2 = dy > 0 ? GRID_COUNT - 1 : 0;
    }

    laserBeam = {
        x1: x1, y1: y1,
        x2: x2, y2: y2,
        time: Date.now()
    };

    // Check if apple is in the line of fire
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type === ItemType.APPLE) {
            let hit = false;
            if (dx !== 0) {
                if (item.y === head.y) {
                    if ((dx > 0 && item.x > head.x) || (dx < 0 && item.x < head.x)) {
                        hit = true;
                    }
                }
            } else {
                if (item.x === head.x) {
                    if ((dy > 0 && item.y > head.y) || (dy < 0 && item.y < head.y)) {
                        hit = true;
                    }
                }
            }

            if (hit) {
                handleItemConsumed(item);
                items.splice(i, 1);
                // Also add a little extra score for skillful laser usage
                score += 5;
                scoreEl.innerText = score;
                break;
            }
        }
    }

    // Visual feedback
    flashOverlay.classList.remove('hidden', 'flash-anim');
    void flashOverlay.offsetWidth;
    flashOverlay.style.boxShadow = `inset 0 0 100px ${ItemType.LASER.color}`;
    flashOverlay.classList.add('flash-anim');
    setTimeout(() => {
        flashOverlay.classList.add('hidden');
        flashOverlay.style.boxShadow = 'none';
    }, 150);
}

// Main Game Loop
function gameLoop(currentTime) {
    if (currentState !== GameState.PLAYING) return;

    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;
    accumulator += deltaTime;

    // Update powerup timers
    if (activePowerups.size > 0) {
        for (const [type, remaining] of activePowerups) {
            const newRemaining = remaining - deltaTime;
            if (newRemaining <= 0) {
                activePowerups.delete(type);
            } else {
                activePowerups.set(type, newRemaining);
            }
        }
        // Recalculate move speed based on active powerups
        if (activePowerups.has(ItemType.SPEED)) {
            moveInterval = baseMoveInterval * 0.5;
        } else if (activePowerups.has(ItemType.SLOW)) {
            moveInterval = baseMoveInterval * 1.8;
        } else {
            moveInterval = baseMoveInterval;
        }
        updateStatusBarDisplay();
    }

    // Always have a chance to spawn powerups, even if one is active or already on the board
    // 0.035 chance per 180ms frame = ~6 seconds average spawn time
    if (Math.random() < 0.00255) {
        spawnPowerup();
    }

    // Fixed timestep for game logic update
    if (accumulator >= moveInterval) {
        // Update logic
        update();
        accumulator -= moveInterval;
    }

    // Render immediately based on state
    render(deltaTime);

    requestAnimationFrame(gameLoop);
}

function update() {
    direction = nextDirection;

    const head = {
        x: snake[0].x + direction.x,
        y: snake[0].y + direction.y
    };

    // Wall Collision Handling
    let hitWall = false;
    if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE) {
        hitWall = true;
    }

    if (hitWall) {
        if (activePowerups.has(ItemType.INVINCIBLE)) {
            // Wrap around
            if (head.x < 0) head.x = GRID_SIZE - 1;
            else if (head.x >= GRID_SIZE) head.x = 0;
            if (head.y < 0) head.y = GRID_SIZE - 1;
            else if (head.y >= GRID_SIZE) head.y = 0;
        } else {
            gameOver();
            return;
        }
    }

    // Self Collision Handling
    let hitSelf = false;
    for (let i = 0; i < snake.length; i++) {
        if (snake[i].x === head.x && snake[i].y === head.y) {
            hitSelf = true;
            break;
        }
    }

    if (hitSelf && !activePowerups.has(ItemType.INVINCIBLE)) {
        gameOver();
        return;
    }

    snake.unshift(head);
    let eaten = false;

    // Check item collisions
    for (let i = 0; i < items.length; i++) {
        if (head.x === items[i].x && head.y === items[i].y) {
            handleItemConsumed(items[i]);
            items.splice(i, 1);
            eaten = true;
            break;
        }
    }

    if (!eaten) {
        snake.pop(); // Remove tail if nothing eaten
    }
}

function handleItemConsumed(item) {
    if (item.type === ItemType.APPLE) {
        score += item.type.points;
        scoreEl.innerText = score;
        spawnItem(ItemType.APPLE);
    } else {
        // Handle Powerup
        activatePowerup(item.type);
    }
}

function spawnItem(type) {
    let newX, newY, validSpot = false;
    while (!validSpot) {
        newX = Math.floor(Math.random() * GRID_SIZE);
        newY = Math.floor(Math.random() * GRID_SIZE);
        validSpot = true;
        for (let i = 0; i < snake.length; i++) {
            if (snake[i].x === newX && snake[i].y === newY) {
                validSpot = false;
                break;
            }
        }
        for (let i = 0; i < items.length; i++) {
            if (items[i].x === newX && items[i].y === newY) {
                validSpot = false;
                break;
            }
        }
    }
    items.push({ x: newX, y: newY, type: type });
}

function spawnPowerup() {
    // Allow multiple powerups on the board simultaneously; check removed

    // Determine type
    // Determine type (Increased Invincibility rate)
    const rand = Math.random();
    let type;
    if (rand < 0.20) type = ItemType.SPEED;         // 20%
    else if (rand < 0.40) type = ItemType.SLOW;     // 20%
    else if (rand < 0.80) type = ItemType.INVINCIBLE; // 40%
    else type = ItemType.LASER;                     // 20%

    spawnItem(type);

    // Despawn after some time if not collected (increased to 12s)
    setTimeout(() => {
        if (currentState === GameState.PLAYING) {
            const idx = items.findIndex(i => i.type === type);
            if (idx !== -1) items.splice(idx, 1);
        }
    }, 12000);
}


function togglePause() {
    if (currentState === GameState.PLAYING) {
        currentState = GameState.PAUSED;
        pauseOverlay.classList.remove('hidden');
    } else if (currentState === GameState.PAUSED) {
        currentState = GameState.PLAYING;
        pauseOverlay.classList.add('hidden');
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
}

function activatePowerup(type) {
    activePowerups.set(type, type.duration);

    // Trigger flash effect
    flashOverlay.classList.remove('hidden');
    flashOverlay.classList.remove('flash-anim');
    void flashOverlay.offsetWidth;
    flashOverlay.classList.add('flash-anim');
    flashOverlay.style.boxShadow = `inset 0 0 100px ${type.color}`;
    setTimeout(() => {
        flashOverlay.classList.add('hidden');
        flashOverlay.style.boxShadow = 'none';
    }, 300);

    // Recalculate speed
    if (activePowerups.has(ItemType.SPEED)) {
        moveInterval = baseMoveInterval * 0.5;
    } else if (activePowerups.has(ItemType.SLOW)) {
        moveInterval = baseMoveInterval * 1.8;
    } else {
        moveInterval = baseMoveInterval;
    }

    updateStatusBarDisplay();
}

function clearPowerup() {
    activePowerups.clear();
    moveInterval = baseMoveInterval;
    statusBar.className = 'status-bar';
    statusBar.innerText = '';
}

function updateStatusBarDisplay() {
    if (activePowerups.size === 0) {
        statusBar.className = 'status-bar';
        statusBar.innerText = '';
        return;
    }
    // Show all active powerups
    const parts = [];
    statusBar.className = 'status-bar';
    for (const [type, remaining] of activePowerups) {
        const secs = Math.ceil(remaining / 1000);
        parts.push(`${type.name} ${secs}s`);
        // Add the highest-priority status class
        if (type === ItemType.SPEED) statusBar.classList.add('status-speed');
        else if (type === ItemType.SLOW) statusBar.classList.add('status-slow');
        else if (type === ItemType.INVINCIBLE) statusBar.classList.add('status-invincible');
        else if (type === ItemType.LASER) statusBar.classList.add('status-laser');
    }
    statusBar.innerHTML = parts.join(' | ');
}

function gameOver() {
    currentState = GameState.GAME_OVER;
    finalScoreEl.innerText = score;
    gameOverOverlay.classList.remove('hidden');

    // Update personal high score locally
    let localHigh = localStorage.getItem('supersnake_personal_high') || 0;
    if (score > localHigh) {
        localStorage.setItem('supersnake_personal_high', score);
        highScore = score;
        highScoreEl.innerText = highScore;
    }

    // Check if score makes it onto global leaderboard
    const lowestGlobalScore = latestLeaderboard.length < 10 ? 0 : (latestLeaderboard[latestLeaderboard.length - 1]?.score || 0);
    const isLeaderboardBound = score > lowestGlobalScore;

    if (isLeaderboardBound && score > 0) {
        initialsContainer.classList.remove('hidden');
        initialsInput.value = '';
        setTimeout(() => initialsInput.focus(), 100);
    } else {
        initialsContainer.classList.add('hidden');
    }

    displayLeaderboard();
}

// Rendering
function render(dt) {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Laser Beam
    if (laserBeam) {
        const now = Date.now();
        const age = now - laserBeam.time;
        if (age < 150) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(laserBeam.x1 * CELL_SIZE + CELL_SIZE / 2, laserBeam.y1 * CELL_SIZE + CELL_SIZE / 2);
            ctx.lineTo(laserBeam.x2 * CELL_SIZE + CELL_SIZE / 2, laserBeam.y2 * CELL_SIZE + CELL_SIZE / 2);

            // Outer glow
            ctx.strokeStyle = ItemType.LASER.color;
            ctx.lineWidth = age < 50 ? 8 : 4;
            ctx.shadowBlur = 15;
            ctx.shadowColor = ItemType.LASER.color;
            ctx.stroke();

            // Inner core
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = age < 50 ? 4 : 2;
            ctx.shadowBlur = 0;
            ctx.stroke();

            ctx.restore();
        } else {
            laserBeam = null;
        }
    }

    // Draw Grid Lines (optional for aesthetic)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= canvas.width; i += CELL_SIZE) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
    }

    // Draw Items
    items.forEach(item => {
        ctx.fillStyle = item.type.color;
        ctx.shadowBlur = 15;
        ctx.shadowColor = item.type.glow;

        // Slight hover effect animation (optional, logic based on time)
        const offset = Math.sin(performance.now() / 200) * 2;

        ctx.beginPath();
        if (item.type === ItemType.APPLE) {
            // Circle for apple
            ctx.arc(item.x * CELL_SIZE + CELL_SIZE / 2, item.y * CELL_SIZE + CELL_SIZE / 2, CELL_SIZE / 2 - 2, 0, Math.PI * 2);
        } else {
            // Diamond or diff shape for powerups
            ctx.rect(item.x * CELL_SIZE + 4, item.y * CELL_SIZE + 4, CELL_SIZE - 8, CELL_SIZE - 8);
        }
        ctx.fill();
        ctx.shadowBlur = 0; // reset
    });

    // Draw Snake
    const headColor = activePowerups.has(ItemType.INVINCIBLE) ? INVINCIBLE_HEAD_COLOR : SNAKE_HEAD_COLOR;
    const bodyColor = activePowerups.has(ItemType.INVINCIBLE) ? INVINCIBLE_BODY_COLOR : SNAKE_BODY_COLOR;

    for (let i = 0; i < snake.length; i++) {
        const part = snake[i];
        const x = part.x * CELL_SIZE;
        const y = part.y * CELL_SIZE;
        const radius = CELL_SIZE / 2 - 1;

        if (i === 0) {
            ctx.fillStyle = headColor;
            ctx.shadowBlur = activePowerups.size > 0 ? 20 : 10;
            ctx.shadowColor = activePowerups.size > 0 ? [...activePowerups.keys()][0].color : SNAKE_GLOW;

            // Draw rounded head
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2, 8);
            ctx.fill();

            // Add eyes
            ctx.fillStyle = '#000';
            ctx.shadowBlur = 0;

            let eyeSize = CELL_SIZE / 6;
            let eyeOffset = CELL_SIZE / 4;

            // Position eyes based on direction
            if (direction.x === 1) { // Right
                ctx.beginPath(); ctx.arc(x + CELL_SIZE - eyeOffset, y + eyeOffset, eyeSize, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(x + CELL_SIZE - eyeOffset, y + CELL_SIZE - eyeOffset, eyeSize, 0, Math.PI * 2); ctx.fill();
            } else if (direction.x === -1) { // Left
                ctx.beginPath(); ctx.arc(x + eyeOffset, y + eyeOffset, eyeSize, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(x + eyeOffset, y + CELL_SIZE - eyeOffset, eyeSize, 0, Math.PI * 2); ctx.fill();
            } else if (direction.y === 1) { // Down
                ctx.beginPath(); ctx.arc(x + eyeOffset, y + CELL_SIZE - eyeOffset, eyeSize, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(x + CELL_SIZE - eyeOffset, y + CELL_SIZE - eyeOffset, eyeSize, 0, Math.PI * 2); ctx.fill();
            } else if (direction.y === -1) { // Up
                ctx.beginPath(); ctx.arc(x + eyeOffset, y + eyeOffset, eyeSize, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(x + CELL_SIZE - eyeOffset, y + eyeOffset, eyeSize, 0, Math.PI * 2); ctx.fill();
            }
        } else {
            ctx.fillStyle = bodyColor;
            ctx.shadowBlur = 5;
            ctx.shadowColor = bodyColor;

            // Draw slightly smaller rounded body segments
            ctx.beginPath();
            ctx.roundRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4, 6);
            ctx.fill();
        }
    }
    ctx.shadowBlur = 0; // reset
}

// Initial draw to screen so it's not empty
function debugInit() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
debugInit();

// ===== MOBILE TOUCH CONTROLS =====

// On-screen button controls
document.getElementById('btn-up').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (currentState === GameState.PLAYING && direction.y !== 1) {
        nextDirection = { x: 0, y: -1 };
    }
});

document.getElementById('btn-down').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (currentState === GameState.PLAYING && direction.y !== -1) {
        nextDirection = { x: 0, y: 1 };
    }
});

document.getElementById('btn-left').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (currentState === GameState.PLAYING && direction.x !== 1) {
        nextDirection = { x: -1, y: 0 };
    }
});

document.getElementById('btn-right').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (currentState === GameState.PLAYING && direction.x !== -1) {
        nextDirection = { x: 1, y: 0 };
    }
});

document.getElementById('btn-fire').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (activePowerups.has(ItemType.LASER)) {
        fireLaser();
    }
});

document.getElementById('btn-pause').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    togglePause();
});

// Swipe gesture support on the canvas
let touchStartX = 0;
let touchStartY = 0;

canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.touches && e.touches.length > 0) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    } else {
        touchStartX = e.clientX;
        touchStartY = e.clientY;
    }
}, { passive: false });

canvas.addEventListener('pointerup', (e) => {
    e.preventDefault();
    if (currentState !== GameState.PLAYING) return;

    let clientX, clientY;
    if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    const dx = clientX - touchStartX;
    const dy = clientY - touchStartY;

    // Minimum swipe distance
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;

    if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal swipe
        if (dx > 0 && direction.x !== -1) nextDirection = { x: 1, y: 0 };
        else if (dx < 0 && direction.x !== 1) nextDirection = { x: -1, y: 0 };
    } else {
        // Vertical swipe
        if (dy > 0 && direction.y !== -1) nextDirection = { x: 0, y: 1 };
        else if (dy < 0 && direction.y !== 1) nextDirection = { x: 0, y: -1 };
    }
}, { passive: false });
