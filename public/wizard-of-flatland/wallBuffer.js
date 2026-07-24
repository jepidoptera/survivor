(function () {
    "use strict";

    const WALL_STRIDE = 8;
    const WALL_X1 = 0;
    const WALL_Y1 = 1;
    const WALL_X2 = 2;
    const WALL_Y2 = 3;
    const WALL_LABEL_CODE = 4;
    const WALL_LABEL_SIDE = 5;

    function createEmptyWallBuffer() {
        return new Float32Array(0);
    }

    function getWallCount(walls) {
        validateWallBuffer(walls, "walls");
        return walls.length / WALL_STRIDE;
    }

    function validateWallBuffer(walls, label) {
        if (!(walls instanceof Float32Array)) throw new Error(`Wizard of Flatland ${label} must be a wall buffer`);
        if (walls.length % WALL_STRIDE !== 0) throw new Error(`Wizard of Flatland ${label} has an invalid wall stride`);
    }

    function appendWallSegment(walls, ax, ay, bx, by, labelCode, sideCode = -1) {
        validateWallSegment(ax, ay, bx, by);
        validateWallLabelCode(labelCode, sideCode);
        validateWallBuffer(walls, "wall buffer append source");
        const next = new Float32Array(walls.length + WALL_STRIDE);
        next.set(walls);
        writeWallSegment(next, walls.length, ax, ay, bx, by, labelCode, sideCode);
        return next;
    }

    function concatWallBuffers(left, right) {
        validateWallBuffer(left, "left wall buffer");
        validateWallBuffer(right, "right wall buffer");
        const out = new Float32Array(left.length + right.length);
        out.set(left);
        out.set(right, left.length);
        return out;
    }

    function cloneWallBuffer(walls, label = "wall buffer") {
        validateWallBuffer(walls, label);
        return walls.slice();
    }

    function writeWallSegment(walls, base, ax, ay, bx, by, labelCode, sideCode) {
        validateWallBuffer(walls, "wall segment write target");
        if (!Number.isInteger(base) || base < 0 || base + WALL_STRIDE > walls.length || base % WALL_STRIDE !== 0) {
            throw new Error("Wizard of Flatland wall segment write requires a valid wall buffer offset");
        }
        walls[base + WALL_X1] = ax;
        walls[base + WALL_Y1] = ay;
        walls[base + WALL_X2] = bx;
        walls[base + WALL_Y2] = by;
        walls[base + WALL_LABEL_CODE] = labelCode;
        walls[base + WALL_LABEL_SIDE] = sideCode;
        walls[base + 6] = 0;
        walls[base + 7] = 0;
    }

    function validateWallLabelCode(labelCode, sideCode) {
        if (!Number.isInteger(labelCode) || labelCode <= 0) {
            throw new Error("Wizard of Flatland wall segment requires a label code");
        }
        if (!Number.isInteger(sideCode)) {
            throw new Error("Wizard of Flatland wall segment requires a side code");
        }
    }

    function validateWallSegment(ax, ay, bx, by) {
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
            throw new Error("Wizard of Flatland wall segment requires finite coordinates");
        }
        if (Math.hypot(bx - ax, by - ay) <= 0.001) {
            throw new Error("Wizard of Flatland wall segment requires separated endpoints");
        }
    }

    window.WizardFlatlandWallBuffer = Object.freeze({
        createEmptyWallBuffer,
        getWallCount,
        validateWallBuffer,
        appendWallSegment,
        concatWallBuffers,
        cloneWallBuffer
    });
}());
