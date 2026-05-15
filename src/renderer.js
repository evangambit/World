/**
 * Renderer — layer-aware tile + entity rendering pipeline.
 * Handles elevation shadows, roof occlusion, and Y-sorted entity drawing.
 */
import { getTileCanvas, getObjCanvas, Obj, T, TERRAIN_NAMES, OBJ_NAMES, isContainerObject, formatItemStackLabel } from './tiles.js';

export class Renderer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {import('./camera.js').Camera} camera
     */
    constructor(canvas, camera) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.camera = camera;
        this.tileSize = camera.tileSize;
        // Disable smoothing for crisp pixel art
        this.ctx.imageSmoothingEnabled = false;
    }

    /** Call on canvas resize */
    resize(w, h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.ctx.imageSmoothingEnabled = false;
        this.camera.resize(w, h);
    }

    /**
     * Render the full frame.
     * @param {import('./world.js').World3D} world
     * @param {import('./entity.js').Player} player
     * @param {Array<import('./npc.js').NPC>} npcs
     * @param {{x:number,y:number,z:number}|null} hoverTile
     * @param {import('./npc.js').NPC|null} [hoverNpc]
     */
    render(world, player, npcs, hoverTile = null, hoverNpc = null) {
        const ctx = this.ctx;
        const cam = this.camera;
        const ts = this.tileSize;

        // Clear to dark background
        ctx.fillStyle = '#0a0a12';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const bounds = cam.getVisibleBounds();
        const playerTileX = Math.floor(player.x);
        const playerTileY = Math.floor(player.y);
        const playerZ = player.z;
        const playerUnderCeiling = world.hasCeiling(playerTileX, playerTileY, playerZ);
        // Which building is the player currently inside? (null if outdoors)
        const playerBuildingId = playerUnderCeiling
            ? world.getBuildingId(playerTileX, playerTileY, playerZ)
            : null;

        // Determine which z-layers to render
        const layersToRender = new Set();
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
            for (let x = bounds.minX; x <= bounds.maxX; x++) {
                const layers = world.getLayersAt(x, y);
                for (const z of layers) layersToRender.add(z);
            }
        }
        const sortedLayers = [...layersToRender].sort((a, b) => a - b);

        // Collect all entities
        const allEntities = [player, ...npcs];

        // Render each z-layer
        for (const z of sortedLayers) {
            const isPlayerLayer = z === playerZ;
            const isAbovePlayer = z > playerZ;
            const isBelowPlayer = z < playerZ;

            // Dim layers below the player when on an upper floor
            if (isBelowPlayer && playerZ > 0) {
                ctx.globalAlpha = 0.5;
            } else {
                // Above-player layers (roofs, upper floors) render at FULL alpha.
                // Individual tiles belonging to the player's building are hidden
                // per-tile below, rather than making all roofs translucent.
                ctx.globalAlpha = 1.0;
            }

            // ── Draw terrain tiles ──
            for (let y = bounds.minY; y <= bounds.maxY; y++) {
                for (let x = bounds.minX; x <= bounds.maxX; x++) {
                    const tile = world.getTile(x, y, z);
                    if (!tile) continue;

                    // Hide roof/ceiling tiles that belong to the player's current building
                    if (isAbovePlayer && playerBuildingId !== null
                        && tile.buildingId === playerBuildingId) {
                        continue; // skip — player is inside this building
                    }

                    // Hide interior tiles of OTHER buildings the player is NOT
                    // inside. Perimeter tiles (walls, doors) have interior=false
                    // and remain visible.
                    if (isPlayerLayer && tile.interior
                        && tile.buildingId !== null
                        && tile.buildingId !== playerBuildingId) {
                        continue;
                    }

                    const screen = cam.worldToScreen(x, y);
                    // Snap to integer pixels to prevent sub-pixel gaps
                    const sx = Math.floor(screen.x);
                    const sy = Math.floor(screen.y);
                    const seed = (x * 7919 + y * 104729 + z * 31) & 0x7FFFFFFF;

                    // Draw terrain
                    const tileCanvas = getTileCanvas(tile.terrain, seed);
                    if (tileCanvas) {
                        ctx.drawImage(tileCanvas, sx, sy, ts, ts);
                    }
                    if (tile.terrain === T.DOOR && tile.doorLocked) {
                        ctx.fillStyle = 'rgba(22, 18, 32, 0.52)';
                        ctx.fillRect(sx + 2, sy + 2, ts - 4, ts - 4);
                        ctx.fillStyle = '#8a7a58';
                        ctx.fillRect(sx + 7, sy + 6, 3, 5);
                        ctx.strokeStyle = '#c4a265';
                        ctx.lineWidth = 1;
                        ctx.strokeRect(sx + 6, sy + 5, 5, 7);
                    }

                    // Elevation shadow: if this tile is elevated, draw shadow on the south edge
                    if (z > 0 && !world.getTile(x, y + 1, z) && tile.terrain !== T.ROOF) {
                        ctx.fillStyle = 'rgba(0,0,0,0.3)';
                        ctx.fillRect(sx, sy + ts - 4, ts, 4);
                    }
                }
            }

            // ── Draw objects, Y-sorted with entities at this layer ──
            const drawables = [];

            for (let y = bounds.minY; y <= bounds.maxY; y++) {
                for (let x = bounds.minX; x <= bounds.maxX; x++) {
                    const tile = world.getTile(x, y, z);
                    if (!tile || !tile.obj) continue;

                    // Hide objects above player in their building
                    if (isAbovePlayer && playerBuildingId !== null
                        && tile.buildingId === playerBuildingId) {
                        continue;
                    }
                    // Hide interior objects of other buildings
                    if (isPlayerLayer && tile.interior
                        && tile.buildingId !== null
                        && tile.buildingId !== playerBuildingId) {
                        continue;
                    }

                    drawables.push({ type: 'obj', x: x, y: y + 0.5, z, objType: tile.obj, tileX: x, tileY: y });
                }
            }

            // Collect entities on this layer
            for (const ent of allEntities) {
                if (ent.z === z) {
                    drawables.push({ type: 'entity', y: ent.y, entity: ent });
                }
            }

            // Sort by Y for proper occlusion
            drawables.sort((a, b) => a.y - b.y);

            for (const d of drawables) {
                if (d.type === 'obj') {
                    const objCanvas = getObjCanvas(d.objType);
                    if (objCanvas) {
                        const screen = cam.worldToScreen(d.tileX, d.tileY);
                        ctx.drawImage(objCanvas, Math.floor(screen.x), Math.floor(screen.y), ts, ts);
                    }
                } else {
                    const savedAlpha = ctx.globalAlpha;
                    ctx.globalAlpha = 1.0;
                    const ent = d.entity;
                    const sprite = ent.getSprite();
                    if (sprite) {
                        const screen = cam.worldToScreen(ent.x - 0.5, ent.y - 0.9);
                        ctx.drawImage(sprite, screen.x, screen.y, ts, ts * 1.0);
                    }
                    // Draw name label for NPCs
                    if (ent.name && ent !== allEntities[0]) {
                        const screen = cam.worldToScreen(ent.x, ent.y - 1.3);
                        ctx.fillStyle = 'rgba(10,10,18,0.6)';
                        ctx.font = '9px "Press Start 2P", monospace';
                        const tw = ctx.measureText(ent.name).width;
                        ctx.fillRect(screen.x - tw / 2 - 2, screen.y - 4, tw + 4, 12);
                        ctx.fillStyle = '#e0d8c0';
                        ctx.textAlign = 'center';
                        ctx.fillText(ent.name, screen.x, screen.y + 5);
                    }
                    ctx.globalAlpha = savedAlpha;
                }
            }
        }

        // Reset alpha
        ctx.globalAlpha = 1.0;

        // ── Ambient lighting overlay (subtle warm tint) ──
        ctx.fillStyle = 'rgba(255, 240, 200, 0.03)';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // ── Tile hover highlight ──
        if (hoverTile) {
            const ht = hoverTile;
            const screen = cam.worldToScreen(ht.x, ht.y);
            const hx = Math.floor(screen.x);
            const hy = Math.floor(screen.y);

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 2;
            ctx.strokeRect(hx + 1, hy + 1, ts - 2, ts - 2);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.fillRect(hx, hy, ts, ts);
        }
    }

    /**
     * Hover tooltip (draw after pause overlay so it stays visible).
     * @param {import('./world.js').World3D} world
     * @param {{x:number,y:number,z:number}} hoverTile
     * @param {import('./npc.js').NPC|null} hoverNpc
     */
    drawHoverTooltip(world, hoverTile, hoverNpc = null) {
        const ctx = this.ctx;
        const cam = this.camera;
        const ts = this.tileSize;
        const ht = hoverTile;
        const screen = cam.worldToScreen(ht.x, ht.y);
        const hx = Math.floor(screen.x);
        const hy = Math.floor(screen.y);

        const tile = world.getTile(ht.x, ht.y, ht.z);
        const lines = [];
        if (hoverNpc) {
            lines.push(hoverNpc.name);
            lines.push('Inventory:');
            const items = hoverNpc.inventory ?? [];
            if (items.length === 0) {
                lines.push('(empty)');
            } else {
                for (const { objType, count, buildingId } of items) {
                    lines.push(formatItemStackLabel(objType, count, buildingId));
                }
            }
        } else {
            lines.push(`(${ht.x}, ${ht.y}) z=${ht.z}`);
            if (tile) {
                lines.push(`Terrain: ${TERRAIN_NAMES[tile.terrain] || 'Unknown'}`);
                if (tile.terrain === T.DOOR) {
                    if (tile.buildingId != null) {
                        lines.push(`Door #${tile.buildingId} · key #${tile.buildingId}`);
                    }
                    lines.push(tile.doorLocked ? 'Door: locked' : 'Door: unlocked');
                    lines.push('E: toggle (inside, or key outside)');
                }
                if (tile.obj) {
                    const objLine = tile.obj === Obj.KEY
                        ? `Object: ${formatItemStackLabel(tile.obj, 1, tile.keyBuildingId)}`
                        : `Object: ${OBJ_NAMES[tile.obj] || 'Unknown'}`;
                    lines.push(objLine);
                }
                if (isContainerObject(tile.obj)) {
                    const n = (tile.contents ?? []).reduce((s, e) => s + e.count, 0);
                    lines.push(`Stored: ${n} item(s)`);
                }
                if (tile.ceiling) lines.push('Indoor');
                if (tile.transition) lines.push(`→ z=${tile.transition.tz} (${tile.transition.type})`);
            } else {
                lines.push('(empty)');
            }
        }

        ctx.font = '11px "Press Start 2P", monospace';
        const lineH = 16;
        const pad = 8;
        const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
        const tooltipW = maxW + pad * 2;
        const tooltipH = lines.length * lineH + pad * 2;

        let tx = hx + ts + 8;
        let ty = hy;
        if (tx + tooltipW > this.canvas.width) tx = hx - tooltipW - 8;
        if (ty + tooltipH > this.canvas.height) ty = this.canvas.height - tooltipH;
        if (ty < 0) ty = 0;

        ctx.fillStyle = 'rgba(10, 10, 24, 0.85)';
        ctx.beginPath();
        const r = 4;
        ctx.roundRect(tx, ty, tooltipW, tooltipH, r);
        ctx.fill();

        ctx.strokeStyle = 'rgba(200, 190, 160, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(tx, ty, tooltipW, tooltipH, r);
        ctx.stroke();

        ctx.fillStyle = '#e0d8c0';
        ctx.textAlign = 'left';
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], tx + pad, ty + pad + lineH * (i + 0.8));
        }
    }
}
