(function () {
    "use strict";

    function createSpellDataSystem(deps) {
        const state = deps && deps.state;
        const constants = deps && deps.constants;
        if (!state || typeof state !== "object") throw new Error("Wizard of Flatland spell data requires state");
        if (!constants || typeof constants !== "object") throw new Error("Wizard of Flatland spell data requires constants");

        let spellLevelDefinitions = null;
        let spellLevelFetchPromise = null;

        function clampSpellLevel(level) {
            const n = Number(level);
            if (!Number.isFinite(n)) return constants.SPELL_LEVEL_MIN;
            return Math.max(constants.SPELL_LEVEL_MIN, Math.min(constants.SPELL_LEVEL_MAX, Math.round(n)));
        }

        function normalizeWizardSpellLevels() {
            if (!state.spellLevels || typeof state.spellLevels !== "object" || Array.isArray(state.spellLevels)) {
                throw new Error("Wizard of Flatland spellLevels must be an object");
            }
            Object.keys(state.spellLevels).forEach((spellId) => {
                state.spellLevels[spellId] = clampSpellLevel(state.spellLevels[spellId]);
            });
            return state.spellLevels;
        }

        function normalizeSpellLevelDefinitions(payload) {
            if (!payload || typeof payload !== "object" || !Array.isArray(payload.spells)) {
                throw new Error("Wizard of Flatland spell level data must contain a spells array");
            }
            const seen = new Set();
            return payload.spells.map((spell, index) => {
                if (!spell || typeof spell !== "object") {
                    throw new Error(`Wizard of Flatland spell level data entry ${index} is not an object`);
                }
                const id = typeof spell.id === "string" ? spell.id.trim().toLowerCase() : "";
                if (!id) throw new Error(`Wizard of Flatland spell level data entry ${index} is missing id`);
                if (seen.has(id)) throw new Error(`Wizard of Flatland duplicate spell level id: ${id}`);
                seen.add(id);
                if (!Array.isArray(spell.levels) || spell.levels.length !== constants.SPELL_LEVEL_MAX) {
                    throw new Error(`Wizard of Flatland spell level data for ${id} must contain exactly ${constants.SPELL_LEVEL_MAX} levels`);
                }
                const levels = spell.levels.map((levelEntry, levelIndex) => {
                    if (!levelEntry || typeof levelEntry !== "object") {
                        throw new Error(`Wizard of Flatland spell level ${id}.${levelIndex + 1} is not an object`);
                    }
                    const level = clampSpellLevel(levelEntry.level);
                    if (level !== levelIndex + 1) {
                        throw new Error(`Wizard of Flatland spell level ${id}.${levelIndex + 1} has mismatched level ${levelEntry.level}`);
                    }
                    if (typeof levelEntry.headline !== "string" || !levelEntry.headline.trim()) {
                        throw new Error(`Wizard of Flatland spell level ${id}.${level} is missing headline`);
                    }
                    return { ...levelEntry, level };
                });
                return {
                    ...spell,
                    id,
                    displayName: (typeof spell.displayName === "string" && spell.displayName.trim()) ? spell.displayName.trim() : id,
                    icon: (typeof spell.icon === "string" && spell.icon.trim()) ? spell.icon.trim() : "",
                    levels
                };
            });
        }

        function fetchSpellLevelDefinitions() {
            if (spellLevelDefinitions) return Promise.resolve(spellLevelDefinitions);
            if (spellLevelFetchPromise) return spellLevelFetchPromise;
            if (typeof fetch !== "function") {
                throw new Error("Wizard of Flatland spell level interface requires fetch");
            }
            spellLevelFetchPromise = fetch(constants.SPELL_LEVEL_DATA_URL)
                .then((response) => {
                    if (!response || !response.ok) {
                        const status = response ? `${response.status} ${response.statusText || ""}`.trim() : "no response";
                        throw new Error(`Wizard of Flatland failed to load spell level data: ${status}`);
                    }
                    return response.json();
                })
                .then((payload) => {
                    spellLevelDefinitions = normalizeSpellLevelDefinitions(payload);
                    return spellLevelDefinitions;
                })
                .catch((error) => {
                    spellLevelFetchPromise = null;
                    console.error("[wizard of flatland spell levels]", error);
                    throw error;
                });
            return spellLevelFetchPromise;
        }

        function getSpellLevelDefinitions() {
            return spellLevelDefinitions;
        }

        function getWizardSpellLevel(spellId) {
            if (typeof spellId !== "string") return 0;
            const id = spellId.trim().toLowerCase();
            if (!id) return 0;
            const spellLevels = normalizeWizardSpellLevels();
            return Object.prototype.hasOwnProperty.call(spellLevels, id)
                ? clampSpellLevel(spellLevels[id])
                : 0;
        }

        function getLoadedSpellLevelDefinition(spellId) {
            if (typeof spellId !== "string" || spellId.trim().length === 0) {
                throw new Error("Wizard of Flatland spell level lookup requires a spell id");
            }
            if (!Array.isArray(spellLevelDefinitions)) {
                throw new Error("Wizard of Flatland spell level data must be loaded before applying spell stats");
            }
            const id = spellId.trim().toLowerCase();
            const definition = spellLevelDefinitions.find((spell) => spell.id === id);
            if (!definition) throw new Error(`Wizard of Flatland missing spell level definition for ${id}`);
            return definition;
        }

        function requirePositiveSpellLevelNumber(spellId, level, levelData, key) {
            if (!levelData || typeof levelData !== "object") {
                throw new Error(`Wizard of Flatland ${spellId} level ${level} spell stats are missing`);
            }
            const value = Number(levelData[key]);
            if (!(value > 0)) {
                throw new Error(`Wizard of Flatland ${spellId} level ${level} requires positive ${key}`);
            }
            return value;
        }

        function getActiveSpellLevelData(spellId) {
            const definition = getLoadedSpellLevelDefinition(spellId);
            const level = getWizardSpellLevel(definition.id);
            if (level < 1) throw new Error(`Wizard of Flatland cannot cast unlearned spell ${definition.id}`);
            const levelData = definition.levels[level - 1];
            if (!levelData) throw new Error(`Wizard of Flatland missing ${definition.id} level ${level} data`);
            return { definition, level, levelData };
        }

        function getActiveFireballStats() {
            const { level, levelData } = getActiveSpellLevelData("fireball");
            const manaCost = requirePositiveSpellLevelNumber("fireball", level, levelData, "manaCost");
            const damage = requirePositiveSpellLevelNumber("fireball", level, levelData, "damage");
            const explosionRadius = requirePositiveSpellLevelNumber("fireball", level, levelData, "explosionRadius");
            const projectileRadius = requirePositiveSpellLevelNumber("fireball", level, levelData, "projectileRadius");
            const cooldown = requirePositiveSpellLevelNumber("fireball", level, levelData, "castDelay");
            const projectileSpeed = requirePositiveSpellLevelNumber("fireball", level, levelData, "projectileSpeed");
            const range = requirePositiveSpellLevelNumber("fireball", level, levelData, "range");
            return {
                level,
                manaCost,
                damage,
                explosionRadius,
                projectileRadius,
                cooldown,
                projectileSpeed,
                maxAge: range / projectileSpeed
            };
        }

        function getActiveSpikeStats() {
            const { level, levelData } = getActiveSpellLevelData("spikes");
            const manaCost = requirePositiveSpellLevelNumber("spikes", level, levelData, "manaCost");
            const damage = requirePositiveSpellLevelNumber("spikes", level, levelData, "damage");
            const cooldown = requirePositiveSpellLevelNumber("spikes", level, levelData, "castDelay");
            const projectileSpeed = requirePositiveSpellLevelNumber("spikes", level, levelData, "projectileSpeed");
            const range = requirePositiveSpellLevelNumber("spikes", level, levelData, "range");
            return {
                level,
                manaCost,
                damage,
                cooldown,
                projectileSpeed,
                maxAge: range / projectileSpeed
            };
        }

        function getActiveHealingStats() {
            const { level, levelData } = getActiveSpellLevelData("healing");
            const healthPerSecond = requirePositiveSpellLevelNumber("healing", level, levelData, "healthPerSecond");
            return {
                level,
                healthPerSecond
            };
        }

        return Object.freeze({
            clampSpellLevel,
            normalizeWizardSpellLevels,
            normalizeSpellLevelDefinitions,
            fetchSpellLevelDefinitions,
            getSpellLevelDefinitions,
            getWizardSpellLevel,
            getLoadedSpellLevelDefinition,
            requirePositiveSpellLevelNumber,
            getActiveSpellLevelData,
            getActiveFireballStats,
            getActiveSpikeStats,
            getActiveHealingStats
        });
    }

    window.WizardFlatlandSpellData = Object.freeze({
        createSpellDataSystem
    });
}());
