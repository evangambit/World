/**
 * Main game entry point — game loop, system wiring, initialization.
 */
import { Input } from './client/input.js';
import { Camera } from './client/camera.js';
import { Renderer } from './client/renderer.js';
import { Player } from './actors/player.js';
import { NPC, find } from './actors/npc.js';
import { buildVillage, VILLAGE_NPC_SPAWNS, NPC_DEFAULT_INVENTORY } from './content/builder.js';
import {
    Obj,
    OBJ_NAMES,
    isContainerObject,
    canStashInContainer,
    formatItemStackLabel,
    isStoveObject,
} from './world/tiles.js';
import {
    canOpenContainerAt,
    dropFromInventory,
    stashToContainer,
    takeFromContainer,
    toggleDoorLock,
} from './domain/entityActions.js';

class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.input = new Input();
        this.camera = new Camera();
        this.renderer = new Renderer(this.canvas, this.camera);
        this.world = null;
        this.player = null;
        /** @type {NPC[]} */
        this.npcs = [];
        this.lastTime = 0;
        this.layerIndicator = document.getElementById('layer-indicator');
        this.inventoryEl = document.getElementById('inventory-items');
        this.inventoryPanelEl = document.getElementById('inventory-panel');
        this.containerPanelEl = document.getElementById('container-panel');
        this.containerTitleEl = document.getElementById('container-title');
        this.containerItemsEl = document.getElementById('container-items');
        /** Open storage UI target, or null */
        this.openContainer = null;
        /** Mouse position in screen pixels (null when not hovering) */
        this._mouseScreenX = null;
        this._mouseScreenY = null;
        /** Currently hovered tile {x, y, z} or null */
        this.hoverTile = null;
        /** NPC under the hovered tile, if any */
        this.hoverNpc = null;
        /** Whether the game is paused */
        this.paused = false;
        /** Transient UI message (e.g. door feedback) */
        this._msgText = '';
        this._msgTTL = 0;
    }

    init() {
        // Build the world
        this.world = buildVillage();

        // Spawn player in the market square area
        this.player = new Player(28.5, 23.5, 0);
        this.camera.snapTo(this.player.x, this.player.y);

        // Spawn NPCs inside their homes (see VILLAGE_NPC_SPAWNS in builder.js)
        for (const def of VILLAGE_NPC_SPAWNS) {
            const inventory = [...NPC_DEFAULT_INVENTORY, ...(def.inventory ?? [])];
            const npc = new NPC(def.x, def.y, def.z, def.preset, def.name, inventory);
            const homeBid = this.world.getBuildingId(Math.floor(def.x), Math.floor(def.y), def.z);
            if (homeBid != null) {
                npc.tasks.enqueue(find(Obj.KEY, 16, { buildingId: homeBid }));
            }
            if (def.tasks?.length) npc.tasks.enqueueMany(def.tasks);
            this.npcs.push(npc);
        }

        // Handle resize
        this._resize();
        window.addEventListener('resize', () => this._resize());

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
            if (this.player.isAdjacentToTile(tx, ty)) {
                const tile = this.world.getTile(tx, ty, this.player.z);
                if (tile && isStoveObject(tile.obj)) {
                    if (this.player.tryCookAtStove(this.world, tx, ty)) {
                        this._showGameMessage('Cooked a steak.');
                        this._syncInventoryUI();
                    } else {
                        this._showGameMessage('You need uncooked steak in your pack.');
                    }
                    return;
                }
                if (tile && isContainerObject(tile.obj)) {
                    this._openContainerAt(tx, ty);
                    return;
                }
            }
            if (this.player.tryPickUp(this.world, tx, ty)) {
                this._syncInventoryUI();
            }
        });

        this.containerItemsEl?.addEventListener('click', (e) => {
            const row = e.target.closest('[data-take-obj]');
            if (!row || !this.openContainer) return;
            const ot = parseInt(row.dataset.takeObj, 10);
            const bid =
                row.dataset.takeBuilding !== undefined ? parseInt(row.dataset.takeBuilding, 10) : undefined;
            this._takeFromContainer(ot, bid);
        });

        this.inventoryEl?.addEventListener('click', (e) => {
            if (this.paused) return;
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

            const ot = parseInt(row.dataset.dropObj, 10);
            if (Number.isNaN(ot)) return;
            const bid =
                row.dataset.dropBuilding !== undefined ? parseInt(row.dataset.dropBuilding, 10) : undefined;
            this._dropFromInventory(ot, bid);
        });

        this._refreshContainerUI();

        // Hide loading screen
        setTimeout(() => {
            document.getElementById('loading-screen').classList.add('hidden');
        }, 400);

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

    /** @returns {import('./actors/npc.js').NPC|null} */
    _npcUnderCursor(wx, wy, z) {
        let best = null;
        let bestD = Infinity;
        for (const npc of this.npcs) {
            if (npc.z !== z) continue;
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
            row.className =
                'inventory-row inventory-row--drop' + (canStash ? ' inventory-row--clickable' : '');
            row.dataset.dropObj = String(objType);
            if (objType === Obj.KEY && buildingId != null) row.dataset.dropBuilding = String(buildingId);
            if (canStash) {
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

        // ── Update ──
        this.input.update();

        if (this.input.isPressed('escape')) {
            if (this.openContainer) {
                this._closeContainer();
            } else {
                this.paused = !this.paused;
            }
        }

        if (!this.paused && this.input.isPressed('e') && !this.openContainer) {
            this._tryDoorInteract();
        }

        if (!this.paused) {
            this.player.update(this.input, this.world, dt);

            for (const npc of this.npcs) {
                npc.update(this.world, dt);
            }

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
        this.renderer.render(this.world, this.player, this.npcs, this.hoverTile, this.hoverNpc);

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
