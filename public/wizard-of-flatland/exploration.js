(function (globalScope) {
    "use strict";

    const DEFAULT_CELL_SIZE = 0.25;
    const KEY_SCALE = 10000;

    function finite(value, label) {
        const number = Number(value);
        if (!Number.isFinite(number)) throw new Error(`Wizard of Flatland exploration requires finite ${label}`);
        return number;
    }

    function coordinateKey(value) {
        return String(Math.round(finite(value, "wall coordinate") * KEY_SCALE));
    }

    function wallKey(ax, ay, bx, by, labelCode, sideCode) {
        const a = `${coordinateKey(ax)},${coordinateKey(ay)}`;
        const b = `${coordinateKey(bx)},${coordinateKey(by)}`;
        const segment = a < b ? `${a}:${b}` : `${b}:${a}`;
        return `${segment}:${Math.round(labelCode)}:${Math.round(sideCode)}`;
    }

    function createExplorationSystem(options = {}) {
        const cellSize = Number.isFinite(Number(options.cellSize))
            ? Number(options.cellSize)
            : DEFAULT_CELL_SIZE;
        if (!(cellSize > 0)) throw new Error("Wizard of Flatland exploration requires a positive cell size");
        const records = new Map();
        let activeRecords = [];
        let version = 1;

        function createRecord(ax, ay, bx, by, labelCode, sideCode) {
            const aKey = `${coordinateKey(ax)},${coordinateKey(ay)}`;
            const bKey = `${coordinateKey(bx)},${coordinateKey(by)}`;
            if (bKey < aKey) {
                [ax, bx] = [bx, ax];
                [ay, by] = [by, ay];
            }
            const length = Math.hypot(bx - ax, by - ay);
            if (!(length > 0.001)) throw new Error("Wizard of Flatland exploration requires separated wall endpoints");
            return {
                key: wallKey(ax, ay, bx, by, labelCode, sideCode),
                ax,
                ay,
                bx,
                by,
                length,
                cellCount: Math.max(1, Math.ceil(length / cellSize)),
                bits: new Uint32Array(Math.ceil(Math.max(1, Math.ceil(length / cellSize)) / 32))
            };
        }

        function getOrCreateRecord(ax, ay, bx, by, labelCode, sideCode) {
            const key = wallKey(ax, ay, bx, by, labelCode, sideCode);
            let record = records.get(key);
            if (!record) {
                record = createRecord(ax, ay, bx, by, labelCode, sideCode);
                records.set(key, record);
            }
            return record;
        }

        function syncWalls(walls, layout) {
            validateWallInput(walls, layout);
            const next = new Array(walls.length / layout.stride);
            for (let base = 0; base < walls.length; base += layout.stride) {
                const ax = walls[base + layout.x1];
                const ay = walls[base + layout.y1];
                const bx = walls[base + layout.x2];
                const by = walls[base + layout.y2];
                const record = getOrCreateRecord(
                    ax,
                    ay,
                    bx,
                    by,
                    walls[base + layout.labelCode],
                    walls[base + layout.sideCode]
                );
                next[base / layout.stride] = {
                    key: record.key,
                    record,
                    reversed: coordinateKey(ax) !== coordinateKey(record.ax) || coordinateKey(ay) !== coordinateKey(record.ay)
                };
            }
            const topologyChanged =
                next.length !== activeRecords.length ||
                next.some((record, index) => record.key !== activeRecords[index].key);
            activeRecords = next;
            if (topologyChanged) version++;
        }

        function validateWallInput(walls, layout) {
            if (!(walls instanceof Float32Array)) throw new Error("Wizard of Flatland exploration requires a wall buffer");
            if (!layout || !Number.isInteger(layout.stride) || layout.stride <= 0 || walls.length % layout.stride !== 0) {
                throw new Error("Wizard of Flatland exploration requires a valid wall layout");
            }
            for (const field of ["x1", "y1", "x2", "y2", "labelCode", "sideCode"]) {
                if (!Number.isInteger(layout[field])) throw new Error(`Wizard of Flatland exploration wall layout requires ${field}`);
            }
        }

        function isCellExplored(record, cellIndex) {
            return (record.bits[cellIndex >>> 5] & (1 << (cellIndex & 31))) !== 0;
        }

        function revealCellRange(record, first, last) {
            const start = Math.max(0, Math.min(record.cellCount - 1, Math.floor(first)));
            const end = Math.max(0, Math.min(record.cellCount - 1, Math.floor(last)));
            let changed = false;
            for (let cell = Math.min(start, end); cell <= Math.max(start, end); cell++) {
                const word = cell >>> 5;
                const mask = 1 << (cell & 31);
                if ((record.bits[word] & mask) !== 0) continue;
                record.bits[word] |= mask;
                changed = true;
            }
            return changed;
        }

        function cellAtT(record, wallT) {
            const t = Math.max(0, Math.min(1, finite(wallT, "wall hit position")));
            return Math.min(record.cellCount - 1, Math.floor(t * record.cellCount));
        }

        function applyVisibility(hitWallIndices, hitWallTs) {
            if (!(hitWallIndices instanceof Int32Array) || !(hitWallTs instanceof Float32Array)) {
                throw new Error("Wizard of Flatland exploration requires typed LOS hit buffers");
            }
            if (hitWallIndices.length !== hitWallTs.length) {
                throw new Error("Wizard of Flatland exploration LOS hit buffers must have matching lengths");
            }
            let changed = false;
            let previousWallIndex = -1;
            let previousCell = -1;
            let firstWallIndex = -1;
            let firstCell = -1;
            for (let i = 0; i < hitWallIndices.length; i++) {
                const wallIndex = hitWallIndices[i];
                if (wallIndex < 0) {
                    previousWallIndex = -1;
                    previousCell = -1;
                    continue;
                }
                const active = activeRecords[wallIndex];
                if (!active) throw new Error(`Wizard of Flatland exploration LOS hit references missing wall ${wallIndex}`);
                const record = active.record;
                const hitT = active.reversed ? 1 - hitWallTs[i] : hitWallTs[i];
                const cell = cellAtT(record, hitT);
                if (firstWallIndex < 0) {
                    firstWallIndex = wallIndex;
                    firstCell = cell;
                }
                const first = previousWallIndex === wallIndex ? Math.min(previousCell, cell) - 1 : cell - 1;
                const last = previousWallIndex === wallIndex ? Math.max(previousCell, cell) + 1 : cell + 1;
                if (revealCellRange(record, first, last)) changed = true;
                previousWallIndex = wallIndex;
                previousCell = cell;
            }
            if (previousWallIndex >= 0 && previousWallIndex === firstWallIndex) {
                const record = activeRecords[previousWallIndex].record;
                if (revealCellRange(record, Math.min(previousCell, firstCell) - 1, Math.max(previousCell, firstCell) + 1)) {
                    changed = true;
                }
            }
            if (changed) version++;
            return changed;
        }

        function forEachActiveInterval(callback) {
            if (typeof callback !== "function") throw new Error("Wizard of Flatland exploration interval visitor is required");
            for (const active of activeRecords) {
                const record = active.record;
                let start = -1;
                for (let cell = 0; cell <= record.cellCount; cell++) {
                    const explored = cell < record.cellCount && isCellExplored(record, cell);
                    if (explored && start < 0) start = cell;
                    if (explored || start < 0) continue;
                    callback(record, start / record.cellCount, cell / record.cellCount);
                    start = -1;
                }
            }
        }

        function inheritSplit(parent, children) {
            if (!parent || !Array.isArray(children)) throw new Error("Wizard of Flatland exploration split inheritance requires wall pieces");
            const source = records.get(wallKey(parent.ax, parent.ay, parent.bx, parent.by, parent.labelCode, parent.sideCode));
            if (!source) return false;
            let changed = false;
            const dx = parent.bx - parent.ax;
            const dy = parent.by - parent.ay;
            const lengthSquared = dx * dx + dy * dy;
            if (!(lengthSquared > 0)) throw new Error("Wizard of Flatland exploration split parent must be separated");
            for (const child of children) {
                const target = getOrCreateRecord(child.ax, child.ay, child.bx, child.by, child.labelCode, child.sideCode);
                for (let cell = 0; cell < target.cellCount; cell++) {
                    const t = (cell + 0.5) / target.cellCount;
                    const x = target.ax + (target.bx - target.ax) * t;
                    const y = target.ay + (target.by - target.ay) * t;
                    const parentT = ((x - parent.ax) * dx + (y - parent.ay) * dy) / lengthSquared;
                    if (isCellExplored(source, cellAtT(source, parentT)) && revealCellRange(target, cell, cell)) changed = true;
                }
            }
            if (changed) version++;
            return changed;
        }

        function reset() {
            records.clear();
            activeRecords = [];
            version++;
        }

        return Object.freeze({
            syncWalls,
            applyVisibility,
            forEachActiveInterval,
            inheritSplit,
            reset,
            getVersion: () => version,
            getCellSize: () => cellSize
        });
    }

    globalScope.getWizardFlatlandExplorationApi = function getWizardFlatlandExplorationApi() {
        return Object.freeze({ createExplorationSystem });
    };
})(typeof window !== "undefined" ? window : globalThis);
