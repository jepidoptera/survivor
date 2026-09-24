(function attachTradeSystem(global) {
    const TRADE_MODAL_ID = "tradeModal";
    const TRADE_MODAL_BACKDROP_ID = "tradeModalBackdrop";

    function formatLabel(value) {
        const raw = String(value || "").trim();
        if (!raw.length) return "";
        return raw
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/\b\w/g, char => char.toUpperCase());
    }

    function getInventory(wizardRef) {
        if (!wizardRef || typeof wizardRef.getInventory !== "function") return null;
        return wizardRef.getInventory();
    }

    function getCurrencyAmount(wizardRef, currencyKey) {
        const inventory = getInventory(wizardRef);
        if (!inventory || !currencyKey) return 0;
        return inventory.get(currencyKey);
    }

    function setCurrencyAmount(wizardRef, currencyKey, amount) {
        const inventory = getInventory(wizardRef);
        if (!inventory || !currencyKey) return 0;
        return inventory.set(currencyKey, amount);
    }

    function ensureUniqueList(list) {
        if (!Array.isArray(list)) return [];
        const seen = new Set();
        const out = [];
        list.forEach(value => {
            const key = String(value || "").trim().toLowerCase();
            if (!key || seen.has(key)) return;
            seen.add(key);
            out.push(key);
        });
        return out;
    }

    function syncSpellAndAuraState(wizardRef) {
        if (
            global.SpellSystem &&
            typeof global.SpellSystem.syncWizardUnlockState === "function"
        ) {
            global.SpellSystem.syncWizardUnlockState(wizardRef);
        }
    }

    function getUnlockedMagicList(wizardRef) {
        if (!wizardRef) return [];
        if (
            global.SpellSystem &&
            typeof global.SpellSystem.getAllMagicNames === "function"
        ) {
            const allowed = global.SpellSystem.getAllMagicNames();
            return ensureUniqueList(wizardRef.unlockedMagic).filter(name => allowed.includes(name));
        }
        return ensureUniqueList(wizardRef.unlockedMagic);
    }

    function addUnlockedMagic(wizardRef, magicName) {
        if (!wizardRef || !magicName) return false;
        if (
            global.SpellSystem &&
            typeof global.SpellSystem.grantMagicUnlock === "function"
        ) {
            const changed = global.SpellSystem.grantMagicUnlock(wizardRef, magicName);
            syncSpellAndAuraState(wizardRef);
            return changed || getUnlockedMagicList(wizardRef).includes(String(magicName).trim().toLowerCase());
        }
        const unlocked = getUnlockedMagicList(wizardRef);
        const normalizedName = String(magicName).trim().toLowerCase();
        if (!unlocked.includes(normalizedName)) unlocked.push(normalizedName);
        wizardRef.unlockedMagic = unlocked;
        return true;
    }

    function removeUnlockedMagic(wizardRef, magicName) {
        if (!wizardRef || !magicName) return false;
        if (
            global.SpellSystem &&
            typeof global.SpellSystem.revokeMagicUnlock === "function"
        ) {
            const changed = global.SpellSystem.revokeMagicUnlock(wizardRef, magicName);
            syncSpellAndAuraState(wizardRef);
            return changed || !getUnlockedMagicList(wizardRef).includes(String(magicName).trim().toLowerCase());
        }
        const normalizedName = String(magicName).trim().toLowerCase();
        wizardRef.unlockedMagic = getUnlockedMagicList(wizardRef).filter(name => name !== normalizedName);
        return !wizardRef.unlockedMagic.includes(normalizedName);
    }

    const assetAdapters = {
        inventoryItem: {
            getQuantity(wizardRef, entry) {
                const inventory = getInventory(wizardRef);
                return inventory ? inventory.get(entry.id) : 0;
            },
            add(wizardRef, entry, quantity) {
                const inventory = getInventory(wizardRef);
                if (!inventory) return false;
                inventory.add(entry.id, quantity);
                return true;
            },
            remove(wizardRef, entry, quantity) {
                const inventory = getInventory(wizardRef);
                if (!inventory) return false;
                return inventory.remove(entry.id, quantity);
            },
            maxQuantity(entry) {
                return Number.isFinite(entry.maxQuantity)
                    ? Math.max(0, Math.floor(entry.maxQuantity))
                    : Infinity;
            }
        },
        spell: {
            getQuantity(wizardRef, entry) {
                const unlocked = getUnlockedMagicList(wizardRef);
                return unlocked.includes(entry.id) ? 1 : 0;
            },
            add(wizardRef, entry) {
                if (!wizardRef) return false;
                addUnlockedMagic(wizardRef, entry.id);
                syncSpellAndAuraState(wizardRef);
                return true;
            },
            remove(wizardRef, entry) {
                if (!wizardRef) return false;
                removeUnlockedMagic(wizardRef, entry.id);
                syncSpellAndAuraState(wizardRef);
                return !getUnlockedMagicList(wizardRef).includes(entry.id);
            },
            maxQuantity() {
                return 1;
            }
        },
        aura: {
            getQuantity(wizardRef, entry) {
                const unlocked = getUnlockedMagicList(wizardRef);
                return unlocked.includes(entry.id) ? 1 : 0;
            },
            add(wizardRef, entry) {
                if (!wizardRef) return false;
                addUnlockedMagic(wizardRef, entry.id);
                syncSpellAndAuraState(wizardRef);
                return true;
            },
            remove(wizardRef, entry) {
                if (!wizardRef) return false;
                removeUnlockedMagic(wizardRef, entry.id);
                syncSpellAndAuraState(wizardRef);
                return !getUnlockedMagicList(wizardRef).includes(entry.id);
            },
            maxQuantity() {
                return 1;
            }
        },
        magic: {
            getQuantity(wizardRef, entry) {
                const unlocked = getUnlockedMagicList(wizardRef);
                return unlocked.includes(entry.id) ? 1 : 0;
            },
            add(wizardRef, entry) {
                if (!wizardRef) return false;
                addUnlockedMagic(wizardRef, entry.id);
                syncSpellAndAuraState(wizardRef);
                return true;
            },
            remove(wizardRef, entry) {
                if (!wizardRef) return false;
                removeUnlockedMagic(wizardRef, entry.id);
                syncSpellAndAuraState(wizardRef);
                return !getUnlockedMagicList(wizardRef).includes(entry.id);
            },
            maxQuantity() {
                return 1;
            }
        }
    };

    function normalizeEntry(rawEntry, index) {
        const src = (rawEntry && typeof rawEntry === "object") ? rawEntry : {};
        const type = String(src.type || "inventoryItem").trim();
        const adapter = assetAdapters[type];
        if (!adapter) return null;
        const rawId = String(src.id || src.name || "").trim().toLowerCase();
        if (!rawId.length) return null;
        const buyPrice = Number(src.buy);
        const sellPrice = Number(src.sell);
        return {
            key: `${type}:${rawId}:${index}`,
            type,
            id: rawId,
            label: (typeof src.label === "string") ? src.label : formatLabel(rawId),
            image: (typeof src.image === "string" && src.image.trim().length > 0)
                ? src.image.trim()
                : ((typeof src.icon === "string" && src.icon.trim().length > 0) ? src.icon.trim() : ""),
            buyPrice: Number.isFinite(buyPrice) ? Math.max(0, buyPrice) : null,
            sellPrice: Number.isFinite(sellPrice) ? Math.max(0, sellPrice) : null,
            canBuy: src.canBuy !== undefined ? !!src.canBuy : Number.isFinite(buyPrice),
            canSell: src.canSell !== undefined ? !!src.canSell : Number.isFinite(sellPrice),
            quantity: Number.isFinite(src.quantity) ? Math.max(1, Math.floor(src.quantity)) : 1,
            maxQuantity: src.maxQuantity,
            adapter
        };
    }

    function createSession(config, wizardRef) {
        const source = (config && typeof config === "object") ? config : {};
        const entries = Array.isArray(source.entries)
            ? source.entries.map(normalizeEntry).filter(Boolean)
            : [];
        return {
            wizard: wizardRef || null,
            title: String(source.title || "Trade"),
            description: String(source.description || ""),
            currencyKey: String(source.currency || "").trim(),
            currencyLabel: String(source.currencyLabel || formatLabel(source.currency || "currency")),
            closeText: String(source.closeText || "Done"),
            requireCurrencyDepletedToClose: source.requireCurrencyDepletedToClose === true,
            entries,
            transferCounts: {}
        };
    }

    function getTransferCount(session, entry) {
        return Number(session && session.transferCounts && session.transferCounts[entry.key]) || 0;
    }

    function getEntryQuantity(session, entry) {
        if (!session || !entry || !entry.adapter) return 0;
        return Math.max(0, Number(entry.adapter.getQuantity(session.wizard, entry)) || 0);
    }

    function getBuyPrice(session, entry) {
        const transferCount = getTransferCount(session, entry);
        return transferCount < 0 ? entry.sellPrice : entry.buyPrice;
    }

    function getSellPrice(session, entry) {
        const transferCount = getTransferCount(session, entry);
        return transferCount > 0 ? entry.buyPrice : entry.sellPrice;
    }

    function canBuyEntry(session, entry) {
        if (!session || !entry || !entry.canBuy || entry.buyPrice === null) return false;
        const currentQuantity = getEntryQuantity(session, entry);
        const maxQuantity = entry.adapter.maxQuantity(entry);
        if (currentQuantity + entry.quantity > maxQuantity) return false;
        return getCurrencyAmount(session.wizard, session.currencyKey) >= getBuyPrice(session, entry);
    }

    function canSellEntry(session, entry) {
        if (!session || !entry || !entry.canSell || entry.sellPrice === null) return false;
        return getEntryQuantity(session, entry) >= entry.quantity;
    }

    function shouldHideBuyEntry(session, entry) {
        if (!session || !entry) return false;
        if (!["spell", "aura", "magic"].includes(entry.type)) return false;
        return canSellEntry(session, entry);
    }

    function attachTradeScrollbar($list) {
        if (!$list || !$list.length) return $list;

        const $shell = $("<div>").addClass("tradeEntryListShell");
        const $rail = $("<div>").addClass("tradeEntryScrollbar");
        const $thumb = $("<div>").addClass("tradeEntryScrollbarThumb");
        $rail.append($thumb);
        $shell.append($list, $rail);

        const updateScrollbar = () => {
            const element = $list.get(0);
            if (!element) return;
            const viewportHeight = element.clientHeight || 0;
            const contentHeight = element.scrollHeight || 0;
            const maxScroll = Math.max(0, contentHeight - viewportHeight);
            const needsScrollbar = maxScroll > 1;

            $shell.toggleClass("has-scroll", needsScrollbar);
            if (!needsScrollbar) {
                $thumb.css({ height: "0px", transform: "translateY(0px)" });
                return;
            }

            const trackHeight = $rail.height() || viewportHeight;
            const thumbHeight = Math.max(56, Math.min(trackHeight, (viewportHeight / contentHeight) * trackHeight));
            const travel = Math.max(0, trackHeight - thumbHeight);
            const top = maxScroll > 0 ? (element.scrollTop / maxScroll) * travel : 0;

            $thumb.css({
                height: `${thumbHeight}px`,
                transform: `translateY(${top}px)`
            });
        };

        $list.on("scroll.tradeScrollbar", updateScrollbar);
        setTimeout(updateScrollbar, 0);
        $(window).off("resize.tradeScrollbar").on("resize.tradeScrollbar", updateScrollbar);
        return $shell;
    }

    function applyBuy(session, entry) {
        if (!canBuyEntry(session, entry)) return false;
        const price = getBuyPrice(session, entry);
        const nextCurrency = getCurrencyAmount(session.wizard, session.currencyKey) - price;
        if (nextCurrency < 0) return false;
        if (!entry.adapter.add(session.wizard, entry, entry.quantity)) return false;
        setCurrencyAmount(session.wizard, session.currencyKey, nextCurrency);
        session.transferCounts[entry.key] = getTransferCount(session, entry) + entry.quantity;
        return true;
    }

    function applySell(session, entry) {
        if (!canSellEntry(session, entry)) return false;
        const price = getSellPrice(session, entry);
        if (!entry.adapter.remove(session.wizard, entry, entry.quantity)) return false;
        setCurrencyAmount(
            session.wizard,
            session.currencyKey,
            getCurrencyAmount(session.wizard, session.currencyKey) + price
        );
        session.transferCounts[entry.key] = getTransferCount(session, entry) - entry.quantity;
        return true;
    }

    function buildEntryCard(session, entry, side) {
        const isBuySide = side === "buy";
        const actionAllowed = isBuySide ? canBuyEntry(session, entry) : canSellEntry(session, entry);
        const $card = $("<button>")
            .addClass("tradeEntryCard")
            .toggleClass("is-disabled", !actionAllowed)
            .attr("type", "button");

        if (!actionAllowed) {
            $card.prop("disabled", true);
        }

        if (entry.image) {
            $card.append(
                $("<div>")
                    .addClass("tradeEntryImage")
                    .css("background-image", `url('${entry.image.replace(/'/g, "\\'")}')`)
            );
        }
        if (typeof entry.label === "string" && entry.label.trim().length > 0) {
            $card.append(
                $("<div>")
                    .addClass("tradeEntryLabel")
                    .text(entry.label)
            );
        }

        $card.on("click", () => {
            const didApply = isBuySide ? applyBuy(session, entry) : applySell(session, entry);
            if (didApply) renderTradeModal(session);
        });

        return $card;
    }

    function canCloseSession(session) {
        if (!session || !session.requireCurrencyDepletedToClose) return true;
        return getCurrencyAmount(session.wizard, session.currencyKey) <= 0;
    }

    function renderTradeModal(session) {
        const $root = $(`#${TRADE_MODAL_ID}`);
        if (!$root.length) return;
        $root.empty();

        const currencyAmount = getCurrencyAmount(session.wizard, session.currencyKey);
        const $shell = $("<div>").addClass("tradeModalShell");
        const $header = $("<div>").addClass("tradeModalHeader");
        const $titleBlock = $("<div>").addClass("tradeModalTitleBlock");
        $titleBlock.append($("<div>").addClass("tradeModalTitle").text(session.title));
        if (session.description) {
            $titleBlock.append(
                $("<div>")
                    .addClass("tradeModalDescription")
                    .text(session.description)
            );
        }
        $header.append($titleBlock);
        $header.append(
            $("<div>")
                .addClass("tradeCurrencyBadge")
                .append($("<span>").addClass("tradeCurrencyLabel").text(session.currencyLabel))
                .append($("<span>").addClass("tradeCurrencyValue").text(currencyAmount))
        );
        $shell.append($header);

        const $columns = $("<div>").addClass("tradeModalColumns");
        const $buyColumn = $("<div>").addClass("tradeColumn tradeColumnBuy");
        const $sellColumn = $("<div>").addClass("tradeColumn tradeColumnSell");
        $buyColumn.append($("<div>").addClass("tradeColumnTitle"));
        $sellColumn.append($("<div>").addClass("tradeColumnTitle"));

        const buyEntries = session.entries.filter(entry => entry.canBuy && !shouldHideBuyEntry(session, entry));
        const sellEntries = session.entries.filter(entry => entry.canSell && canSellEntry(session, entry));

        const $buyList = $("<div>").addClass("tradeEntryList");
        if (buyEntries.length > 0) {
            buyEntries.forEach(entry => $buyList.append(buildEntryCard(session, entry, "buy")));
        }

        const $sellList = $("<div>").addClass("tradeEntryList");
        if (sellEntries.length > 0) {
            sellEntries.forEach(entry => $sellList.append(buildEntryCard(session, entry, "sell")));
        }

        $buyColumn.append(attachTradeScrollbar($buyList));
        $sellColumn.append(attachTradeScrollbar($sellList));
        $columns.append($buyColumn, $sellColumn);
        $shell.append($columns);

        const canClose = canCloseSession(session);
        $shell.append(
            $("<div>")
                .addClass("tradeModalFooter")
                .append(
                    !canClose && session.requireCurrencyDepletedToClose
                        ? $("<div>")
                            .addClass("tradeModalFooterNote")
                            .text(`Spend all remaining ${session.currencyLabel} to continue.`)
                        : null
                )
                .append(
                    $("<button>")
                        .addClass("tradeDoneButton")
                        .attr("type", "button")
                        .prop("disabled", !canClose)
                        .text(session.closeText)
                        .on("click", () => closeActiveTrade({ cancelled: false }))
                )
        );

        $root.append($shell);
    }

    let activeTradeSession = null;
    let activeTradeResolver = null;
    let activeTradeKeyHandler = null;

    function teardownTradeModal() {
        $(`#${TRADE_MODAL_BACKDROP_ID}`).remove();
        $(window).off("resize.tradeScrollbar");
        if (typeof activeTradeKeyHandler === "function") {
            document.removeEventListener("keydown", activeTradeKeyHandler);
        }
        activeTradeKeyHandler = null;
    }

    function closeActiveTrade(result = {}) {
        if (!activeTradeSession) return false;
        const session = activeTradeSession;
        const resolver = activeTradeResolver;
        activeTradeSession = null;
        activeTradeResolver = null;
        teardownTradeModal();
        if (typeof global.unpause === "function") {
            global.unpause();
        }
        if (typeof resolver === "function") {
            resolver({
                cancelled: !!result.cancelled,
                currency: session.currencyKey,
                currencyAmount: getCurrencyAmount(session.wizard, session.currencyKey),
                transferCounts: { ...session.transferCounts }
            });
        }
        return true;
    }

    function openTrade(config, wizardRef) {
        if (!wizardRef) return Promise.resolve(false);
        if (!String(config && config.currency || "").trim()) return Promise.resolve(false);
        if (activeTradeSession) {
            closeActiveTrade({ cancelled: true });
        }
        const session = createSession(config, wizardRef);
        activeTradeSession = session;

        if (typeof global.prepareModalInteraction === "function") {
            global.prepareModalInteraction();
        }
        if (typeof global.pause === "function") {
            global.pause();
        }

        const $backdrop = $("<div>")
            .attr("id", TRADE_MODAL_BACKDROP_ID)
            .addClass("tradeModalBackdrop");
        const $root = $("<div>")
            .attr("id", TRADE_MODAL_ID)
            .addClass("tradeModal");
        $backdrop.append($root);
        $("body").append($backdrop);
        renderTradeModal(session);

        activeTradeKeyHandler = event => {
            if (event.key === "Escape") {
                if (!canCloseSession(session)) return;
                event.preventDefault();
                closeActiveTrade({ cancelled: false });
            }
        };
        document.addEventListener("keydown", activeTradeKeyHandler);

        return new Promise(resolve => {
            activeTradeResolver = resolve;
        });
    }

    global.TradeSystem = {
        openTrade,
        closeActiveTrade
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
