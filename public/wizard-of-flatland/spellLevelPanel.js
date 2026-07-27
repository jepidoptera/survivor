(function () {
    "use strict";

    function createSpellLevelPanelSystem(deps) {
        const state = deps && deps.state;
        const elements = deps && deps.elements;
        const constants = deps && deps.constants;
        const api = deps && deps.api;
        if (!state || typeof state !== "object") throw new Error("Wizard of Flatland spell level panel requires state");
        if (!elements || typeof elements !== "object") throw new Error("Wizard of Flatland spell level panel requires elements");
        if (!constants || typeof constants !== "object") throw new Error("Wizard of Flatland spell level panel requires constants");
        if (!api || typeof api !== "object") throw new Error("Wizard of Flatland spell level panel requires data api");

        let selectedSpellLevelId = "fireball";

        function getSelectedSpellLevelDefinition() {
            const definitions = api.getSpellLevelDefinitions();
            if (!Array.isArray(definitions) || definitions.length === 0) return null;
            const selected = definitions.find((spell) => spell.id === selectedSpellLevelId);
            return selected || definitions[0];
        }

        function appendSpellLevelStats(container, levelData) {
            const stats = constants.SPELL_LEVEL_STAT_LABELS.filter(([key]) => {
                if (!Object.prototype.hasOwnProperty.call(levelData, key)) return false;
                const value = levelData[key];
                if (value === null || typeof value === "undefined") return false;
                return typeof value !== "string" || value.trim().length > 0;
            });
            if (stats.length === 0) return;
            const statsElement = document.createElement("div");
            statsElement.className = "spellLevelStats";
            for (const [key, label] of stats) {
                const stat = document.createElement("div");
                stat.className = "spellLevelStat";
                stat.textContent = `${label}: ${levelData[key]}`;
                statsElement.append(stat);
            }
            container.append(statsElement);
        }

        function appendSpellLevelInfo(container, label, levelData) {
            const labelElement = document.createElement("div");
            labelElement.className = label.startsWith("next") ? "spellLevelNextText" : "spellLevelCurrentText";
            labelElement.textContent = label;
            container.append(labelElement);
            if (!levelData) return;
            const headline = document.createElement("div");
            headline.className = "spellLevelHeadline";
            headline.textContent = levelData.headline;
            container.append(headline);
            if (typeof levelData.subtitle === "string" && levelData.subtitle.length > 0) {
                const subtitle = document.createElement("div");
                subtitle.className = "spellLevelSubtitle";
                subtitle.textContent = levelData.subtitle;
                container.append(subtitle);
            }
            appendSpellLevelStats(container, levelData);
        }

        function renderSpellLevelLoading(message) {
            validatePanelDom();
            api.validateWizardLevelPoints();
            elements.spellLevelHeader.textContent = `level points ${state.levelPoints}`;
            elements.spellLevelList.replaceChildren();
            const loading = document.createElement("div");
            loading.className = "spellLevelMastered";
            loading.textContent = message;
            elements.spellLevelDetails.style.display = "flex";
            elements.spellLevelDetails.replaceChildren(loading);
        }

        function renderSpellLevelPanel() {
            validatePanelDom();
            api.validateWizardLevelPoints();
            api.normalizeWizardSpellLevels();
            elements.spellLevelHeader.textContent = `level points ${state.levelPoints}`;
            const definitions = api.getSpellLevelDefinitions();
            if (!Array.isArray(definitions)) {
                renderSpellLevelLoading("Loading spell levels...");
                return;
            }
            if (definitions.length === 0) {
                throw new Error("Wizard of Flatland spell level data contains no spells");
            }
            if (!definitions.some((spell) => spell.id === selectedSpellLevelId)) {
                selectedSpellLevelId = definitions[0].id;
            }
            elements.spellLevelList.replaceChildren();
            for (const spell of definitions) {
                const level = api.getWizardSpellLevel(spell.id);
                const item = document.createElement("button");
                item.type = "button";
                item.className = "spellLevelListItem";
                item.classList.toggle("selected", spell.id === selectedSpellLevelId);
                item.dataset.spellLevelId = spell.id;
                item.addEventListener("click", () => {
                    selectedSpellLevelId = spell.id;
                    renderSpellLevelPanel();
                });
                const icon = document.createElement("div");
                icon.className = "spellLevelListIcon";
                icon.style.backgroundImage = `url("${spell.icon}")`;
                const text = document.createElement("div");
                text.className = "spellLevelListText";
                const name = document.createElement("div");
                name.className = "spellLevelListName";
                name.textContent = spell.displayName;
                const levelText = document.createElement("div");
                levelText.className = "spellLevelListLevel";
                levelText.textContent = `Level ${level}`;
                text.append(name, levelText);
                item.append(icon, text);
                elements.spellLevelList.append(item);
            }

            const selected = getSelectedSpellLevelDefinition();
            if (!selected) throw new Error("Wizard of Flatland selected spell level definition is missing");
            const currentLevel = api.getWizardSpellLevel(selected.id);
            const currentData = currentLevel > 0 ? selected.levels[currentLevel - 1] : null;
            const nextData = currentLevel < constants.SPELL_LEVEL_MAX ? selected.levels[currentLevel] : null;
            const current = document.createElement("div");
            current.className = "spellLevelSection";
            appendSpellLevelInfo(current, `current level: ${currentLevel}`, currentData);
            const divider = document.createElement("div");
            divider.className = "spellLevelDivider";
            if (currentLevel < constants.SPELL_LEVEL_MAX) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "spellLevelUpButton";
                button.disabled = state.levelPoints <= 0;
                button.textContent = "level up";
                button.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    api.levelUpWizardSpell(selected.id);
                });
                divider.append(button);
            }
            const next = document.createElement("div");
            next.className = "spellLevelSection";
            if (currentLevel >= constants.SPELL_LEVEL_MAX) {
                const mastered = document.createElement("div");
                mastered.className = "spellLevelMastered";
                mastered.textContent = "You have mastered this spell.";
                next.append(mastered);
            } else {
                appendSpellLevelInfo(next, `next level: ${currentLevel + 1}`, nextData);
            }
            elements.spellLevelDetails.style.display = "";
            elements.spellLevelDetails.replaceChildren(current, divider, next);
        }

        function refreshSpellLevelPanel() {
            if (!elements.spellLevelPanel || elements.spellLevelPanel.classList.contains("hidden")) return;
            renderSpellLevelPanel();
        }

        function showSpellLevelPanel() {
            if (!elements.spellLevelPanel) throw new Error("Wizard of Flatland spell level panel is missing");
            selectedSpellLevelId = typeof state.selectedSpell === "string" && state.selectedSpell.length > 0
                ? state.selectedSpell
                : selectedSpellLevelId;
            elements.spellLevelPanel.classList.remove("hidden");
            renderSpellLevelLoading("Loading spell levels...");
            api.fetchSpellLevelDefinitions()
                .then(() => renderSpellLevelPanel())
                .catch((error) => {
                    renderSpellLevelLoading("Unable to load spell level data.");
                    console.error("[wizard of flatland spell levels] unable to open panel", error);
                });
        }

        function hideSpellLevelPanel() {
            if (!elements.spellLevelPanel) throw new Error("Wizard of Flatland spell level panel is missing");
            elements.spellLevelPanel.classList.add("hidden");
        }

        function isSpellLevelPanelOpen() {
            return !!(elements.spellLevelPanel && !elements.spellLevelPanel.classList.contains("hidden"));
        }

        function validatePanelDom() {
            if (!elements.spellLevelPanel || !elements.spellLevelHeader || !elements.spellLevelList || !elements.spellLevelDetails) {
                throw new Error("Wizard of Flatland spell level panel DOM is missing");
            }
        }

        return Object.freeze({
            renderSpellLevelPanel,
            renderSpellLevelLoading,
            refreshSpellLevelPanel,
            showSpellLevelPanel,
            hideSpellLevelPanel,
            isSpellLevelPanelOpen
        });
    }

    window.WizardFlatlandSpellLevelPanel = Object.freeze({
        createSpellLevelPanelSystem
    });
}());
