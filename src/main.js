/**
 * Main game entry point — game loop, system wiring, initialization.
 */
import { Input } from './client/input.js';
import { Camera } from './client/camera.js';
import { Renderer } from './client/renderer.js';
import { Entity } from './actors/entity.js';
import { updatePlayerFromInput } from './client/playerController.js';
import { tickSimulation } from './simulation/tickSimulation.js';
import { NPC, find } from './actors/npc.js';
import { createNpcPlannerFromConfig } from './npc/llm/createLlmPlanner.js';
import { resolveBrowserPlannerConfig } from './npc/llm/plannerRuntime.js';
import { clearGrass } from './npc/npcTasks.js';
import { buildVillage, VILLAGE_NPC_SPAWNS, NPC_DEFAULT_INVENTORY } from './content/builder.js';
import {
    Obj,
    OBJ_NAMES,
    isContainerObject,
    canStashInContainer,
    formatItemStackLabel,
    isStoveObject,
    isWheatCropObject,
    isClearableGrassTerrain,
} from './world/tileTypes.js';
import {
    canOpenContainerAt,
    cookAtStove,
    dropFromInventory,
    pickUpAtTile,
    stashToContainer,
    takeFromContainer,
    toggleDoorLock,
} from './domain/entityActions.js';
import { inventoryHasUncookedSteak } from './domain/cooking.js';
import {
    harvestWheatAtTile,
    plantWheatSeedAtTile,
} from './domain/crops.js';
import { consumeFoodFromInventory, isEdible, VITALITY } from './domain/vitality.js';
class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.input = new Input();
        this.camera = new Camera();
        this.renderer = new Renderer(this.canvas, this.camera);
        this.world = null;
        /** @type {Entity|null} */
        this.player = null;
        /** @type {NPC[]} */
        this.npcs = [];
        this.lastTime = 0;
        /** Smoothed frames per second (exponential moving average) */
        this._fpsEma = 60;
        this.layerIndicator = document.getElementById('layer-indicator');
        this.fpsIndicator = document.getElementById('fps-indicator');
        this.inventoryEl = document.getElementById('inventory-items');
        this.inventoryPanelEl = document.getElementById('inventory-panel');
        this.containerPanelEl = document.getElementById('container-panel');
        this.containerTitleEl = document.getElementById('container-title');
        this.containerItemsEl = document.getElementById('container-items');
        this.healthFillEl = document.getElementById('health-fill');
        this.hungerFillEl = document.getElementById('hunger-fill');
        this.healthTextEl = document.getElementById('health-text');
        this.hungerTextEl = document.getElementById('hunger-text');
        /** Open storage UI target, or null */
        this.openContainer = null;
        /** Mouse position in screen pixels (null when not hovering) */
        this._mouseScreenX = null;
        this._mouseScreenY = null;
        /** Currently hovered tile {x, y, z} or null */
        this.hoverTile = null;
        /** NPC under the hovered tile, if any */
        this.hoverNpc = null;
        /** NPC selected by click (plan panel) */
        this.selectedNpc = null;
        this.npcPanelEl = document.getElementById('npc-panel');
        this.npcPanelNameEl = document.getElementById('npc-panel-name');
        this.npcPanelPlanEl = document.getElementById('npc-panel-plan');
        /** Whether the game is paused */
        this.paused = false;
        /** Transient UI message (e.g. door feedback) */
        this._msgText = '';
        this._msgTTL = 0;
        /** Elapsed simulation seconds (crop growth, etc.) */
        this.gameTime = 0;
    }

    init() {
        // Build the world
        this.world = buildVillage();

        // Spawn player in the market square area
        this.player = new Entity(28.5, 23.5, 0);
        this.player.speed = 4;
        this.player.appearance = ['#e8c090', '#5a3020', '#2a5a8a', '#3a3a4a'];
        this.camera.snapTo(this.player.x, this.player.y);

        /** @type {import('./npc/llm/npcPlanner.js').NpcPlannerFn | undefined} */
        let llmPlanner;
        const llmConfig = resolveBrowserPlannerConfig();
        if (llmConfig) {
            try {
                llmPlanner = createNpcPlannerFromConfig(llmConfig);
                const modelLabel = llmConfig.model ?? 'default model';
                console.log(`[World] LLM planner: ${llmConfig.providerId} (${modelLabel})`);
                const hint = document.getElementById('controls-hint');
                if (hint) {
                    hint.textContent += ` · LLM: ${llmConfig.providerId}`;
                }
            } catch (err) {
                console.warn('[World] LLM planner failed to start', err);
            }
        }

        // Spawn NPCs inside their homes (see VILLAGE_NPC_SPAWNS in builder.js)
        for (const def of VILLAGE_NPC_SPAWNS) {
            const inventory = [...NPC_DEFAULT_INVENTORY, ...(def.inventory ?? [])];
            const brainOpts = llmPlanner ? { planner: llmPlanner } : {};
            const npc = new NPC(def.x, def.y, def.z, def.preset, def.name, inventory, brainOpts);
            const homeBid = this.world.getBuildingId(Math.floor(def.x), Math.floor(def.y), def.z);
            if (homeBid != null) {
                npc.tasks.enqueue(find(Obj.KEY, 16, { buildingId: homeBid }));
            }
            if (def.tasks?.length) npc.tasks.enqueueMany(def.tasks);
            this.npcs.push(npc);
        }

        // Finn clears a grass patch outside his house, then resumes wandering
        const finn = this.npcs.find((n) => n.name === 'Finn');
        if (finn) finn.tasks.enqueue(clearGrass(13, 32, 0));

        // Handle resize
        this._resize();
        window.addEventListener('resize', () => this._resize());

        this.canvas.addEventListener('mousedown', () => {
            this.canvas.focus({ preventScroll: true });
        });

        // Mouse tracking
        this.canvas.addEventListener('mousemove', (e) => {
            const dpr = window.devicePixelRatio || 1;
            this._mouseScreenX = e.offsetX * dpr;
            this._mouseScreenY = e.offsetY * dpr;
        });
        this.canvas.addEventListener('mouseleave', () => {
            this._mouseScreenX = null;
            this._mouseScreenY = null;
            this.hoverTile = null;
            this.hoverNpc = null;
        });

        this.canvas.addEventListener('click', (e) => {
            if (this.paused) return;
            const dpr = window.devicePixelRatio || 1;
            const sx = e.offsetX * dpr;
            const sy = e.offsetY * dpr;
            const worldPos = this.camera.screenToWorld(sx, sy);
            const tx = Math.floor(worldPos.x);
            const ty = Math.floor(worldPos.y);
            const clickedNpc = this._npcUnderCursor(worldPos.x, worldPos.y, this.player.z);
            if (clickedNpc) {
                this.selectedNpc = clickedNpc;
                this._syncNpcPanel();
                return;
            }
            this.selectedNpc = null;
            this._syncNpcPanel();
            this._interruptPlayerWork();

            if (this.player.isAdjacentToTile(tx, ty)) {
                const tile = this.world.getTile(tx, ty, this.player.z);
                if (
                    tile &&
                    !tile.obj &&
                    isClearableGrassTerrain(tile.terrain)
                ) {
                    const result = this.player.timedAction.start(
                        'clear_grass',
                        this.world,
                        tx,
                        ty,
                    );
                    if (result.ok) {
                        this._showGameMessage(result.message);
                    } else if (result.message) {
                        this._showGameMessage(result.message);
                    }
                    return;
                }
                if (tile && isWheatCropObject(tile.obj)) {
                    const result = harvestWheatAtTile(
                        this.player,
                        this.world,
                        tx,
                        ty,
                        this.gameTime,
                    );
                    if (result.message) this._showGameMessage(result.message);
                    if (result.ok) this._syncInventoryUI();
                    return;
                }
                if (tile && !tile.obj) {
                    const plant = plantWheatSeedAtTile(
                        this.player,
                        this.world,
                        tx,
                        ty,
                        this.gameTime,
                    );
                    if (plant.ok) {
                        this._showGameMessage(plant.message);
                        this._syncInventoryUI();
                        return;
                    }
                }
                if (tile && isStoveObject(tile.obj)) {
                    if (cookAtStove(this.player, this.world, tx, ty)) {
                        this._showGameMessage('Cooked a steak.');
                        this._syncInventoryUI();
                    } else if (!inventoryHasUncookedSteak(this.player.inventory ?? [])) {
                        this._showGameMessage('You need uncooked steak in your pack.');
                    }
                    return;
                }
                if (tile && isContainerObject(tile.obj)) {
                    this._openContainerAt(tx, ty);
                    return;
                }
            }
            if (pickUpAtTile(this.player, this.world, tx, ty, this.player.z)) {
                this._syncInventoryUI();
            }
        });

        this.containerItemsEl?.addEventListener('click', (e) => {
            if (this.paused) return;
            this._interruptPlayerWork();
            const row = e.target.closest('[data-take-obj]');
            if (!row || !this.openContainer) return;
            const ot = parseInt(row.dataset.takeObj, 10);
            const bid =
                row.dataset.takeBuilding !== undefined ? parseInt(row.dataset.takeBuilding, 10) : undefined;
            this._takeFromContainer(ot, bid);
        });

        this.inventoryEl?.addEventListener('click', (e) => {
            if (this.paused) return;
            this._interruptPlayerWork();
            const row = e.target.closest('.inventory-row');
            if (!row || !this.player) return;

            if (
                this.openContainer &&
                row.dataset.stashObj != null &&
                row.classList.contains('inventory-row--clickable')
            ) {
                const ot = parseInt(row.dataset.stashObj, 10);
                const bid =
                    row.dataset.stashBuilding !== undefined
                        ? parseInt(row.dataset.stashBuilding, 10)
                        : undefined;
                this._stashToContainer(ot, bid);
                return;
            }

            if (row.dataset.eatObj != null) {
                const ot = parseInt(row.dataset.eatObj, 10);
                const bid =
                    row.dataset.eatBuilding !== undefined
                        ? parseInt(row.dataset.eatBuilding, 10)
                        : undefined;
                if (consumeFoodFromInventory(this.player, ot, bid)) {
                    this._syncInventoryUI();
                    this._syncVitalsUI();
                    this._showGameMessage('Ate food.');
                }
                return;
            }

            const ot = parseInt(row.dataset.dropObj, 10);
            if (Number.isNaN(ot)) return;
            const bid =
                row.dataset.dropBuilding !== undefined ? parseInt(row.dataset.dropBuilding, 10) : undefined;
            this._dropFromInventory(ot, bid);
        });

        this._refreshContainerUI();
        this._syncVitalsUI();

        // Hide loading screen
        setTimeout(() => {
            document.getElementById('loading-screen').classList.add('hidden');
        }, 400);

        this.canvas.focus({ preventScroll: true });

        // Start game loop
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this._loop(t));
    }

    _resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth * dpr;
        const h = window.innerHeight * dpr;
        this.renderer.resize(w, h);
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
    }

    _showGameMessage(text) {
        this._msgText = text;
        this._msgTTL = 2.8;
    }

    /** @returns {boolean} whether a timed action was cancelled */
    _interruptPlayerWork() {
        if (!this.player?.timedAction.isBusy()) return false;
        this.player.timedAction.cancel();
        return true;
    }

    _drawActionProgress() {
        const runner = this.player?.timedAction;
        if (!runner?.isBusy()) return;

        const ctx = this.canvas.getContext('2d');
        const label = runner.getLabel();
        const progress = runner.getProgress();
        const barW = Math.min(220, this.canvas.width - 48);
        const barH = 10;
        const bx = (this.canvas.width - barW) / 2;
        const by = this.canvas.height - 108;

        ctx.save();
        ctx.font = '9px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(10, 10, 18, 0.8)';
        ctx.beginPath();
        ctx.roundRect(bx - 8, by - 22, barW + 16, 40, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(196, 162, 101, 0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#c4a265';
        ctx.fillText(label, this.canvas.width / 2, by - 8);

        ctx.fillStyle = 'rgba(40, 36, 28, 0.9)';
        ctx.fillRect(bx, by, barW, barH);
        ctx.fillStyle = '#6a9a40';
        ctx.fillRect(bx, by, barW * progress, barH);
        ctx.strokeStyle = 'rgba(224, 216, 192, 0.35)';
        ctx.strokeRect(bx, by, barW, barH);

        ctx.fillStyle = 'rgba(224, 216, 192, 0.55)';
        ctx.fillText('Move or click elsewhere to stop', this.canvas.width / 2, by + barH + 14);
        ctx.restore();
    }

    /** @returns {import('./actors/npc.js').NPC|null} */
    _npcUnderCursor(wx, wy, z) {
        let best = null;
        let bestD = Infinity;
        for (const npc of this.npcs) {
            if (!npc.isAlive || npc.z !== z) continue;
            const dist = Math.hypot(npc.x - wx, npc.y - wy);
            if (dist > 0.65 || dist >= bestD) continue;
            best = npc;
            bestD = dist;
        }
        return best;
    }

    _tryDoorInteract() {
        const result = toggleDoorLock(this.player, this.world);
        if (result.message && result.message !== 'No door nearby') {
            this._showGameMessage(result.message);
        }
    }

    _dropFromInventory(objType, buildingId) {
        const { message } = dropFromInventory(this.player, this.world, objType, buildingId);
        this._syncInventoryUI();
        this._showGameMessage(message);
    }

    _openContainerAt(tx, ty) {
        const z = this.player.z;
        if (!canOpenContainerAt(this.player, this.world, tx, ty, z)) return;
        this.world.ensureTileContents(tx, ty, z);
        this.openContainer = { x: tx, y: ty, z };
        this._refreshContainerUI();
    }

    _closeContainer() {
        if (!this.openContainer) return;
        this.openContainer = null;
        this._refreshContainerUI();
    }

    _refreshContainerUI() {
        if (this.inventoryPanelEl) {
            this.inventoryPanelEl.style.pointerEvents = 'auto';
        }
        if (this.containerPanelEl) {
            this.containerPanelEl.classList.toggle('hidden', !this.openContainer);
        }
        this._syncContainerPanel();
        this._syncInventoryUI();
    }

    _syncContainerPanel() {
        if (!this.containerItemsEl || !this.containerTitleEl) return;
        const open = this.openContainer;
        if (!open) {
            this.containerItemsEl.replaceChildren();
            return;
        }
        const tile = this.world.getTile(open.x, open.y, open.z);
        if (!tile || !isContainerObject(tile.obj)) {
            this._closeContainer();
            return;
        }
        this.containerTitleEl.textContent = OBJ_NAMES[tile.obj] || 'Storage';
        this.world.ensureTileContents(open.x, open.y, open.z);
        const contents = tile.contents ?? [];
        this.containerItemsEl.replaceChildren();
        if (contents.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'inventory-empty';
            empty.textContent = 'Nothing here';
            this.containerItemsEl.appendChild(empty);
            return;
        }
        for (const stack of contents) {
            const { objType, count, buildingId } = stack;
            const row = document.createElement('div');
            row.className = 'container-row';
            row.dataset.takeObj = String(objType);
            if (objType === Obj.KEY && buildingId != null) row.dataset.takeBuilding = String(buildingId);
            row.title = 'Take into your pack';
            row.textContent = formatItemStackLabel(objType, count, buildingId);
            this.containerItemsEl.appendChild(row);
        }
    }

    _takeFromContainer(objType, buildingId) {
        const open = this.openContainer;
        if (!open) return;
        if (!takeFromContainer(this.player, this.world, open.x, open.y, open.z, objType, buildingId)) {
            return;
        }
        this._syncContainerPanel();
        this._syncInventoryUI();
    }

    _stashToContainer(objType, buildingId) {
        const open = this.openContainer;
        if (!open || !canStashInContainer(objType)) return;
        if (!stashToContainer(this.player, this.world, open.x, open.y, open.z, objType, buildingId)) {
            return;
        }
        this._syncContainerPanel();
        this._syncInventoryUI();
    }

    _syncNpcPanel() {
        const panel = this.npcPanelEl;
        if (!panel || !this.npcPanelNameEl || !this.npcPanelPlanEl) return;

        const npc = this.selectedNpc;
        if (!npc) {
            panel.classList.add('hidden');
            return;
        }

        panel.classList.remove('hidden');
        this.npcPanelNameEl.textContent = npc.name;
        const status = npc.tasks.getPlanStatus();
        this.npcPanelPlanEl.textContent = status.lines.join('\n');
    }

    _syncVitalsUI() {
        const p = this.player;
        if (!p) return;
        const hp = Math.round(p.health);
        const hunger = Math.round(p.hunger);
        if (this.healthTextEl) this.healthTextEl.textContent = String(hp);
        if (this.hungerTextEl) this.hungerTextEl.textContent = String(hunger);
        if (this.healthFillEl) {
            this.healthFillEl.style.width = `${(hp / VITALITY.MAX_HEALTH) * 100}%`;
        }
        if (this.hungerFillEl) {
            this.hungerFillEl.style.width = `${(hunger / VITALITY.MAX_HUNGER) * 100}%`;
        }
    }

    _syncInventoryUI() {
        if (!this.inventoryEl || !this.player) return;
        this.inventoryEl.replaceChildren();
        const items = this.player.inventory ?? [];
        const stashMode = !!this.openContainer;
        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'inventory-empty';
            empty.textContent = 'Empty';
            this.inventoryEl.appendChild(empty);
            return;
        }
        for (const stack of items) {
            const { objType, count, buildingId } = stack;
            const row = document.createElement('div');
            const canStash = stashMode && canStashInContainer(objType);
            const canEat = !stashMode && isEdible(objType);
            row.className =
                'inventory-row inventory-row--drop' +
                (canStash || canEat ? ' inventory-row--clickable' : '');
            row.dataset.dropObj = String(objType);
            if (objType === Obj.KEY && buildingId != null) row.dataset.dropBuilding = String(buildingId);
            if (canEat) {
                row.dataset.eatObj = String(objType);
                if (objType === Obj.KEY && buildingId != null) row.dataset.eatBuilding = String(buildingId);
                row.title = 'Click to eat';
            } else if (canStash) {
                row.dataset.stashObj = String(objType);
                if (objType === Obj.KEY && buildingId != null) row.dataset.stashBuilding = String(buildingId);
                row.title = 'Click to store · or close panel to drop';
            } else {
                row.title = 'Click to drop near you';
            }
            row.textContent = formatItemStackLabel(objType, count, buildingId);
            this.inventoryEl.appendChild(row);
        }
    }

    _loop(timestamp) {
        const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05); // cap at 50ms
        this.lastTime = timestamp;

        if (dt > 0) {
            const instantFps = 1 / dt;
            this._fpsEma = this._fpsEma * 0.9 + instantFps * 0.1;
        }
        if (this.fpsIndicator) {
            this.fpsIndicator.textContent = `${Math.round(this._fpsEma)} FPS`;
        }

        // ── Update ──
        this.input.update();

        if (this.input.isPressed('escape')) {
            if (this.openContainer) {
                this._closeContainer();
            } else if (this.player?.timedAction.isBusy()) {
                this.player.timedAction.cancel();
                this._showGameMessage('Cancelled');
            } else {
                this.paused = !this.paused;
            }
        }

        if (!this.paused && this.input.isPressed('e') && !this.openContainer) {
            if (this.player.timedAction.isBusy()) {
                this._interruptPlayerWork();
            } else {
                this._tryDoorInteract();
            }
        }

        if (!this.paused) {
            updatePlayerFromInput(this.player, this.input, this.world, dt);

            ({ gameTime: this.gameTime } = tickSimulation({
                world: this.world,
                gameTime: this.gameTime,
                dt,
                npcs: this.npcs,
            }));

            this.camera.follow(this.player.x, this.player.y, dt);

            if (this.openContainer) {
                const { x, y } = this.openContainer;
                if (!this.player.isAdjacentToTile(x, y)) {
                    this._closeContainer();
                }
            }
        }

        // Update UI
        const floorNames = { '-1': 'Underground', '0': 'Ground', '1': 'Floor 1', '2': 'Floor 2' };
        this.layerIndicator.textContent = `Floor: ${floorNames[this.player.z] || this.player.z}`;
        this._syncVitalsUI();
        this._syncNpcPanel();

        // Update hovered tile
        if (this._mouseScreenX !== null) {
            const worldPos = this.camera.screenToWorld(this._mouseScreenX, this._mouseScreenY);
            const z = this.player.z;
            this.hoverNpc = this._npcUnderCursor(worldPos.x, worldPos.y, z);
            if (this.hoverNpc) {
                this.hoverTile = {
                    x: Math.floor(this.hoverNpc.x),
                    y: Math.floor(this.hoverNpc.y),
                    z: this.hoverNpc.z,
                };
            } else {
                this.hoverTile = {
                    x: Math.floor(worldPos.x),
                    y: Math.floor(worldPos.y),
                    z,
                };
            }
        } else {
            this.hoverTile = null;
            this.hoverNpc = null;
        }

        // ── Render ──
        this.renderer.render(
            this.world,
            this.player,
            this.npcs,
            this.hoverTile,
            this.hoverNpc,
            this.paused ? 0 : dt,
            this.selectedNpc,
        );

        this._drawActionProgress();

        if (this._msgTTL > 0) {
            this._msgTTL -= Math.min(dt, 0.05);
            const ctx = this.canvas.getContext('2d');
            ctx.save();
            ctx.font = '11px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(10, 10, 18, 0.75)';
            const w = Math.min(ctx.measureText(this._msgText).width + 20, this.canvas.width - 40);
            const bx = (this.canvas.width - w) / 2;
            const by = this.canvas.height - 72;
            ctx.beginPath();
            ctx.roundRect(bx, by, w, 28, 4);
            ctx.fill();
            ctx.strokeStyle = 'rgba(196, 162, 101, 0.45)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = '#e0d8c0';
            ctx.fillText(this._msgText, this.canvas.width / 2, by + 19);
            ctx.restore();
        }

        // Draw pause overlay
        if (this.paused) {
            const ctx = this.canvas.getContext('2d');
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.fillStyle = '#e0d8c0';
            ctx.font = 'bold 36px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('PAUSED', this.canvas.width / 2, this.canvas.height / 2);
            ctx.font = '14px "Press Start 2P", monospace';
            ctx.fillStyle = 'rgba(224, 216, 192, 0.6)';
            ctx.fillText('Press ESC to resume', this.canvas.width / 2, this.canvas.height / 2 + 40);
        }

        if (this.hoverTile) {
            this.renderer.drawHoverTooltip(this.world, this.hoverTile, this.hoverNpc);
        }

        requestAnimationFrame((t) => this._loop(t));
    }
}

// ── Boot ──
window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    game.init();
});
