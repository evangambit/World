/**
 * Character sprite pre-rendering (16×16 walk + work poses).
 */

const DIR = { DOWN: 0, LEFT: 1, RIGHT: 2, UP: 3 };

/**
 * Draw a simple 16×16 pixel-art character.
 * @param {CanvasRenderingContext2D} ctx - offscreen 16×16 canvas context
 * @param {string} skinColor
 * @param {string} hairColor
 * @param {string} shirtColor
 * @param {string} pantsColor
 * @param {number} dir - DIR.* constant
 * @param {number} frame - walk frame (0 or 1)
 */
function drawCharacter(ctx, skinColor, hairColor, shirtColor, pantsColor, dir, frame) {
    ctx.clearRect(0, 0, 16, 16);
    const px = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); };
    const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

    // Head
    rect(5, 1, 6, 5, skinColor);
    // Hair
    rect(5, 1, 6, 2, hairColor);
    if (dir === DIR.LEFT) rect(5, 1, 2, 4, hairColor);
    if (dir === DIR.RIGHT) rect(9, 1, 2, 4, hairColor);

    // Eyes
    if (dir !== DIR.UP) {
        const eyeY = 3;
        if (dir === DIR.DOWN) { px(6, eyeY, '#222'); px(9, eyeY, '#222'); }
        else if (dir === DIR.LEFT) { px(6, eyeY, '#222'); }
        else { px(9, eyeY, '#222'); }
    }

    // Body / shirt
    rect(5, 6, 6, 5, shirtColor);
    // Arms
    if (frame === 0) {
        rect(4, 7, 1, 3, shirtColor);
        rect(11, 7, 1, 3, shirtColor);
    } else {
        rect(4, 6, 1, 3, shirtColor);
        rect(11, 8, 1, 3, shirtColor);
    }
    // Hands
    px(4, frame === 0 ? 10 : 9, skinColor);
    px(11, frame === 0 ? 10 : 11, skinColor);

    // Pants/legs
    const legOffset = frame === 1 ? 1 : 0;
    rect(5, 11, 2, 4, pantsColor);
    rect(9, 11, 2, 4, pantsColor);
    // Feet
    rect(5, 14 + (frame === 1 ? 1 : 0), 2, 1, '#3a2a1a');
    rect(9, 14 + (frame === 0 ? 1 : 0), 2, 1, '#3a2a1a');
}

/**
 * Working pose — arms swing toward facing direction (2 frames).
 * @param {number} frame - 0 = wind-up, 1 = strike
 */
function drawCharacterWorking(ctx, skinColor, hairColor, shirtColor, pantsColor, dir, frame) {
    ctx.clearRect(0, 0, 16, 16);
    const px = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); };
    const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

    const tool = '#6a5030';
    const toolHi = '#8a6840';
    const toolHead = '#5a5a5a';

    const headY = frame === 1 ? 2 : 1;
    rect(5, headY, 6, 5, skinColor);
    rect(5, headY, 6, 2, hairColor);
    if (dir === DIR.LEFT) rect(5, headY, 2, 4, hairColor);
    if (dir === DIR.RIGHT) rect(9, headY, 2, 4, hairColor);

    if (dir !== DIR.UP) {
        const eyeY = headY + 2;
        if (dir === DIR.DOWN) { px(6, eyeY, '#222'); px(9, eyeY, '#222'); }
        else if (dir === DIR.LEFT) { px(6, eyeY, '#222'); }
        else { px(9, eyeY, '#222'); }
    }

    rect(5, 6, 6, 5, shirtColor);
    rect(5, 11, 2, 4, pantsColor);
    rect(9, 11, 2, 4, pantsColor);
    rect(5, 14, 2, 1, '#3a2a1a');
    rect(9, 14, 2, 1, '#3a2a1a');

    const strike = frame === 1;

    if (dir === DIR.DOWN) {
        if (!strike) {
            rect(3, 5, 1, 3, shirtColor);
            rect(12, 5, 1, 3, shirtColor);
            px(3, 4, skinColor);
            px(12, 4, skinColor);
            rect(2, 2, 2, 1, toolHi);
            rect(12, 2, 2, 1, toolHi);
            rect(3, 0, 1, 3, tool);
            rect(12, 0, 1, 3, tool);
            px(3, 0, toolHead);
            px(12, 0, toolHead);
        } else {
            rect(4, 8, 1, 2, shirtColor);
            rect(11, 8, 1, 2, shirtColor);
            px(4, 10, skinColor);
            px(11, 10, skinColor);
            rect(6, 11, 4, 1, toolHi);
            rect(7, 12, 2, 4, tool);
            px(8, 15, toolHead);
        }
    } else if (dir === DIR.UP) {
        if (!strike) {
            rect(3, 6, 1, 3, shirtColor);
            rect(12, 6, 1, 3, shirtColor);
            rect(2, 3, 2, 1, toolHi);
            rect(12, 3, 2, 1, toolHi);
            rect(3, 0, 1, 3, tool);
            rect(12, 0, 1, 3, tool);
        } else {
            rect(5, 6, 1, 2, shirtColor);
            rect(10, 6, 1, 2, shirtColor);
            rect(6, 1, 4, 1, toolHi);
            rect(7, 0, 2, 2, tool);
            px(8, 0, toolHead);
        }
    } else if (dir === DIR.LEFT) {
        if (!strike) {
            rect(4, 6, 1, 3, shirtColor);
            rect(11, 7, 1, 2, shirtColor);
            rect(1, 4, 1, 3, tool);
            rect(2, 3, 2, 1, toolHi);
            px(1, 2, toolHead);
        } else {
            rect(3, 7, 1, 3, shirtColor);
            px(2, 9, skinColor);
            rect(0, 9, 2, 1, toolHi);
            rect(0, 10, 2, 3, tool);
            px(0, 12, toolHead);
        }
    } else {
        if (!strike) {
            rect(4, 7, 1, 2, shirtColor);
            rect(11, 6, 1, 3, shirtColor);
            rect(13, 4, 1, 3, tool);
            rect(12, 3, 2, 1, toolHi);
            px(14, 2, toolHead);
        } else {
            rect(11, 7, 1, 3, shirtColor);
            px(13, 9, skinColor);
            rect(14, 9, 2, 1, toolHi);
            rect(14, 10, 2, 3, tool);
            px(15, 12, toolHead);
        }
    }
}

// ── Pre-render character sprite sheets ──
function buildSpriteSheet(skinColor, hairColor, shirtColor, pantsColor) {
    const sprites = {};
    const workSprites = {};
    const dirs = [DIR.DOWN, DIR.LEFT, DIR.RIGHT, DIR.UP];
    for (const dirVal of dirs) {
        sprites[dirVal] = [];
        workSprites[dirVal] = [];
        for (let frame = 0; frame < 2; frame++) {
            const walk = document.createElement('canvas');
            walk.width = 16;
            walk.height = 16;
            drawCharacter(walk.getContext('2d'), skinColor, hairColor, shirtColor, pantsColor, dirVal, frame);

            const work = document.createElement('canvas');
            work.width = 16;
            work.height = 16;
            drawCharacterWorking(work.getContext('2d'), skinColor, hairColor, shirtColor, pantsColor, dirVal, frame);

            sprites[dirVal].push(walk);
            workSprites[dirVal].push(work);
        }
    }
    return { sprites, workSprites };
}

export { buildSpriteSheet };
