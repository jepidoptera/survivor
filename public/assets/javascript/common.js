class Player{
    constructor(name) {
        // give player initial stats
        this.food = 120;
        this.money = 1550;
        this.mokeballs = 27;
        this.grenades = 9;
        this.speed = 4;
        this.name = name || 'simone';
        // reset to beginning of trail
        this.progress = 1;
        this.time = 0;
        this.day = 0;
        this.messages = ["You set off on the trail! Next stop: the forest of doom."];
        this.posse = [{name: 'dezzy'}, {name: 'apismanion'}, {name: 'mallowbear'}, {name: 'marlequin'}, {name: 'wingmat'}];
        let urlParams = new URLSearchParams(location.search)
        this.authtoken = urlParams.get('auth')    
    }
    get foodPerDay() {
        return 5 + this.posse.reduce((sum, moke) => sum + moke.hunger, 0)
    }
    get currentMessage() {
        return this.messages[this.messages.length - 1]
    }
    uploadJson() {
        const currentLocation = this.currentLocation;
        const currentLocationName = (currentLocation && typeof currentLocation === 'object')
            ? (currentLocation.name ?? null)
            : (typeof currentLocation === 'string' ? currentLocation : null);
        const posse = Array.isArray(this.posse)
            ? this.posse
                .filter(moke => moke && typeof moke === 'object')
                .map(moke => ({
                    type: moke.type ?? null,
                    name: moke.name ?? null,
                    health: moke.health ?? null,
                    conditions: Array.isArray(moke.conditions) ? moke.conditions : []
                }))
            : [];
        return {
            ...this,
            isLoaded: false,
            currentLocation: currentLocationName,
            posse
        }
    }
}
let player = new Player();
let paused = false;
let msgBoxActive = false;
let activeScrollMessageResolver = null;
const INVENTORY_MODAL_ID = "inventoryModal";
const INVENTORY_MODAL_BACKDROP_ID = "inventoryModalBackdrop";
const INVENTORY_TOOLTIP_ID = "inventoryModalTooltip";
let activeInventoryKeyHandler = null;

function resolveActiveScrollMessage(result = true) {
    const resolver = activeScrollMessageResolver;
    activeScrollMessageResolver = null;
    if (typeof resolver === "function") {
        resolver(result);
    }
}

function prepareModalInteraction() {
    if (typeof globalThis !== "undefined" && typeof globalThis.exitGameplayPointerLock === "function") {
        globalThis.exitGameplayPointerLock();
    }
}

function hideScrollDialog(result = true, options = {}) {
    const shouldUnpause = options.unpause !== false;
    const $box = $("#msgbox");
    const customDialogClass = String($box.data("scrollDialogClass") || "").trim();
    if (customDialogClass.length > 0) {
        $box.removeClass(customDialogClass).removeData("scrollDialogClass");
    }
    $box.hide().removeClass("scrollMessageBox").addClass("dialogBox");
    if (shouldUnpause) {
        unpause();
    }
    msgBoxActive = false;
    resolveActiveScrollMessage(result);
}

function appendScrollDialogContent($container, content) {
    if (!$container || content === undefined || content === null) return;
    if (Array.isArray(content)) {
        content.forEach(entry => appendScrollDialogContent($container, entry));
        return;
    }
    if (typeof content === "function") {
        const returned = content($container);
        if (returned !== undefined && returned !== $container) {
            appendScrollDialogContent($container, returned);
        }
        return;
    }
    if (content && content.jquery) {
        $container.append(content);
        return;
    }
    if (typeof Element !== "undefined" && content instanceof Element) {
        $container.append(content);
        return;
    }
    $container.append(document.createTextNode(String(content)));
}

function showScrollDialog(options = {}) {
    prepareModalInteraction();
    if (pause) pause();
    msgBoxActive = true;
    if (activeScrollMessageResolver) {
        resolveActiveScrollMessage(false);
    }

    const title = String(options.title === undefined || options.title === null ? "" : options.title).trim();
    const buttons = Array.isArray(options.buttons) ? options.buttons : [];
    const dialogClass = String(options.dialogClass || "").trim();
    const bodyClass = String(options.bodyClass || "").trim();
    const buttonRowClass = String(options.buttonRowClass || "").trim();
    const $box = $("#msgbox");
    const previousDialogClass = String($box.data("scrollDialogClass") || "").trim();
    if (previousDialogClass.length > 0) {
        $box.removeClass(previousDialogClass);
    }
    const close = (result = true, closeOptions = {}) => {
        if ($box.data("scrollDialogClosed")) return;
        $box.data("scrollDialogClosed", true);
        hideScrollDialog(result, closeOptions);
    };

    $box
        .data("scrollDialogClosed", false)
        .removeClass("dialogBox")
        .addClass("scrollMessageBox")
        .empty()
        .show();
    if (dialogClass.length > 0) {
        $box.addClass(dialogClass).data("scrollDialogClass", dialogClass);
    } else {
        $box.removeData("scrollDialogClass");
    }

    if (title.length > 0) {
        $box.append(
            $("<div>")
                .addClass("scrollMessageTitle")
                .text(title)
        );
    }

    const $contentWrap = $("<div>").addClass("scrollMessageContent scrollDialogContent");
    const $body = $("<div>").addClass("scrollDialogBody");
    if (bodyClass.length > 0) {
        $body.addClass(bodyClass);
    }
    appendScrollDialogContent($body, options.content);
    $contentWrap.append($body);
    $box.append($contentWrap);

    const $buttonRow = $("<div>")
        .attr("id", "msgbuttons")
        .addClass("scrollMessageButtons scrollDialogButtons");
    if (buttonRowClass.length > 0) {
        $buttonRow.addClass(buttonRowClass);
    }
    $box.append($buttonRow);

    buttons.forEach(button => {
        const config = (button && typeof button === "object") ? button : { text: String(button || "ok") };
        const buttonText = String(config.text || "ok");
        const buttonClass = String(config.className || "").trim();
        const closeOnClick = config.close !== false;
        const shouldUnpause = config.unpause !== false;
        const $button = $("<button>")
            .addClass("msgbutton scrollMessageButton")
            .toggleClass(buttonClass, buttonClass.length > 0)
            .text(buttonText)
            .attr("type", config.type || "button")
            .prop("disabled", !!config.disabled)
            .click(async () => {
                if ($button.prop("disabled")) return;
                let actionResult = config.value;
                if (typeof config.onClick === "function") {
                    const maybeResult = await config.onClick({
                        box: $box,
                        body: $body,
                        button: $button,
                        close,
                        options,
                    });
                    if (maybeResult === false) return;
                    if (maybeResult !== undefined) {
                        actionResult = maybeResult;
                    }
                }
                if (closeOnClick) {
                    close(actionResult === undefined ? true : actionResult, { unpause: shouldUnpause });
                }
            });
        $buttonRow.append($button);
    });

    return new Promise(resolve => {
        activeScrollMessageResolver = resolve;
        if (typeof options.onShow === "function") {
            options.onShow({ box: $box, body: $body, close });
        }
    });
}

function msgBox(title, text, buttons = [{text: "ok", function: () => {}}]) {
    prepareModalInteraction();
    if (activeScrollMessageResolver) {
        resolveActiveScrollMessage(false);
    }
    if (pause) pause();
    msgBoxActive = true;
    if (!text) {
        text = title;
        title = "-------"
    }
    $("#msgbox").removeClass("scrollMessageBox").addClass("dialogBox").empty().show()
        .append($("<div>").addClass('msgTitle').text(title))
        .append($("<div>").attr('id', 'msgText').html(text + "<br>"))
        .append($("<div>").attr('id', 'msgbuttons'))
    if (typeof(buttons) === "string") {
        buttons = [{text: buttons}]
    }
    buttons.forEach(button => {
        $("#msgbuttons").append($("<button>")
            .addClass('msgbutton')
            .text(button.text)
            .click(() => {$("#msgbox").hide(); unpause(); msgBoxActive = false; if (button.function) button.function();})
            .attr("type", (buttons.length === 1 ? "submit" : "none"))
        )
    })
    return $("#msgbox");
}

function showScrollMessage(text, buttonText = "ok", title = "") {
    const safeText = String(text === undefined || text === null ? "" : text);
    const safeTitle = String(title === undefined || title === null ? "" : title).trim();
    return showScrollDialog({
        title: safeTitle,
        bodyClass: "scrollMessageText",
        content: safeText,
        buttons: [{
            text: String(buttonText || "ok"),
            type: "submit",
            value: true
        }]
    });
}

function clearDialogs() {
    const $box = $("#msgbox");
    const customDialogClass = String($box.data("scrollDialogClass") || "").trim();
    if (customDialogClass.length > 0) {
        $box.removeClass(customDialogClass).removeData("scrollDialogClass");
    }
    $box.hide().removeClass("scrollMessageBox").addClass("dialogBox");
    $("#optionsMenu").hide();
    closeInventoryDialog({ unpause: false });
    unpause();
    msgBoxActive = false;
    resolveActiveScrollMessage(false);
}

function formatInventoryItemLabel(itemKey) {
    const raw = String(itemKey || "").trim();
    if (!raw.length) return "Unknown Item";
    return raw
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, char => char.toUpperCase());
}

function getInventoryItemIconPath(itemKey) {
    const normalized = String(itemKey || "").trim().toLowerCase();
    if (!normalized.length) return "/assets/images/thumbnails/backpack.png";
    if (normalized === "gold" || normalized === "money") return "/assets/images/powerups/goldcoin.png";
    if (normalized === "black diamond" || normalized === "black_diamond" || normalized === "diamond" || normalized === "diamonds") return "/assets/images/powerups/black%20diamond.png";
    if (normalized === "lightning") return "/assets/images/powerups/lightning.png";
    if (normalized === "spellcredits" || normalized === "spell_credits") return "/assets/images/powerups/spellbook1.png";
    return "/assets/images/thumbnails/backpack.png";
}

function getInventoryEntriesForDialog(wizardRef) {
    if (!wizardRef || typeof wizardRef.getInventory !== "function") return [];
    const inventory = wizardRef.getInventory();
    if (!inventory) return [];
    const rawItems = (typeof inventory.toJSON === "function")
        ? inventory.toJSON()
        : ((inventory.items && typeof inventory.items === "object") ? inventory.items : {});
    return Object.entries(rawItems)
        .map(([key, quantity]) => ({
            key: String(key || "").trim(),
            quantity: Math.floor(Number(quantity) || 0)
        }))
        .filter(entry => entry.key.length > 0 && entry.quantity > 0)
        .sort((a, b) => {
            if (a.key === "gold" && b.key !== "gold") return -1;
            if (b.key === "gold" && a.key !== "gold") return 1;
            if (b.quantity !== a.quantity) return b.quantity - a.quantity;
            return a.key.localeCompare(b.key);
        });
}

function teardownInventoryDialog() {
    $(`#${INVENTORY_MODAL_BACKDROP_ID}`).remove();
    $(`#${INVENTORY_TOOLTIP_ID}`).remove();
    if (typeof activeInventoryKeyHandler === "function") {
        document.removeEventListener("keydown", activeInventoryKeyHandler);
    }
    activeInventoryKeyHandler = null;
}

function closeInventoryDialog(options = {}) {
    const $backdrop = $(`#${INVENTORY_MODAL_BACKDROP_ID}`);
    if (!$backdrop.length) return false;
    teardownInventoryDialog();
    if (options.unpause !== false && typeof unpause === "function") {
        unpause();
    }
    return true;
}

function renderInventoryDialog(wizardRef) {
    const entries = getInventoryEntriesForDialog(wizardRef);
    const $root = $(`#${INVENTORY_MODAL_ID}`);
    if (!$root.length) return;
    $root.empty();

    const $shell = $("<div>").addClass("inventoryModalShell");
    const $list = $("<div>").addClass("inventoryModalList");
    let $tooltip = $(`#${INVENTORY_TOOLTIP_ID}`);
    if (!$tooltip.length) {
        $tooltip = $("<div>")
            .attr("id", INVENTORY_TOOLTIP_ID)
            .addClass("inventoryModalTooltip")
            .appendTo("body");
    }

    const hideTooltip = () => {
        $tooltip.removeClass("is-visible").text("");
    };

    const positionTooltip = event => {
        if (!$tooltip.length || !event) return;
        const offsetX = 18;
        const offsetY = 16;
        const clientX = Number(event.clientX) || 0;
        const clientY = Number(event.clientY) || 0;
        $tooltip.css({
            left: `${clientX + offsetX}px`,
            top: `${clientY - offsetY}px`
        });
    };

    const showTooltip = (event, label) => {
        if (!$tooltip.length || !label) return;
        $tooltip.text(label).addClass("is-visible");
        positionTooltip(event);
    };

    entries.forEach(entry => {
        const $row = $("<div>").addClass("inventoryModalRow");
        const itemLabel = formatInventoryItemLabel(entry.key);
        $row.attr({
            "data-tooltip": itemLabel,
            "aria-label": itemLabel
        });
        $row.on("mouseenter", event => showTooltip(event, itemLabel));
        $row.on("mousemove", positionTooltip);
        $row.on("mouseleave", hideTooltip);
        $row.append(
            $("<div>")
                .addClass("inventoryModalIcon")
                .css("background-image", `url('${getInventoryItemIconPath(entry.key)}')`)
        );
        $row.append(
            $("<div>")
                .addClass("inventoryModalAmount")
                .text(entry.quantity)
        );
        $list.append($row);
    });

    $shell.append($list);
    $root.append($shell);
}

function showInventoryDialog(wizardRef = null) {
    const activeWizard = wizardRef || window.wizard || null;
    closeInventoryDialog({ unpause: false });

    if (typeof prepareModalInteraction === "function") {
        prepareModalInteraction();
    }
    if (typeof pause === "function") {
        pause();
    }

    const $backdrop = $("<div>")
        .attr("id", INVENTORY_MODAL_BACKDROP_ID)
        .addClass("inventoryModalBackdrop");
    const $root = $("<div>")
        .attr("id", INVENTORY_MODAL_ID)
        .addClass("inventoryModal");

    $backdrop.append($root);
    $("body").append($backdrop);
    renderInventoryDialog(activeWizard);

    $backdrop.on("mousedown", event => {
        if (event.target === $backdrop.get(0)) {
            closeInventoryDialog();
        }
    });

    activeInventoryKeyHandler = event => {
        if (event.key === "Escape") {
            event.preventDefault();
            closeInventoryDialog();
        }
    };
    document.addEventListener("keydown", activeInventoryKeyHandler);
    return true;
}

function saveGame() {
    if (typeof saveGameStateToServerFile === "function") {
        return saveGameStateToServerFile().catch(err => {
            console.error('save error: ', err);
            return { ok: false, reason: 'save-failed', error: err };
        });
    }

    return $.ajax({
        method: "POST",
        url: '/save',
        data: {data: JSON.stringify(player.uploadJson())}
    }).fail(err => {
        console.error('save error: ', err);
        return err;
    });
}

function loadPlayer(callback) {
    let urlParams = new URLSearchParams(location.search)
    let authtoken = urlParams.get('auth')

    $.ajax({
        method: "GET",
        url: "/load/" + $("#playerName").text() + "/" + authtoken
    }).done(data => callback({...data, messages: data.messages || [], authtoken: authtoken}))
    .fail(err => {
        console.log('load error: ', err);
        if (err.status === 403) {
            // auth code expired
            window.location.href = "/logout"
        }
        callback({name: urlParams.get('name')})
    });
    // try {
    //     player = JSON.parse($("#playerInfo").text());
    // }
    // catch{
    //     player.name = $("#playerName").text();
    // }
    // $("#playerName").remove();
    // $("#playerInfo").remove();
    // if (this._then) {
    //     this._then(player);
    // }
}

function loadTrail(callback) {
    $.ajax({
        method: "GET",
        url: "/load/trail"
    }).done(data => {
        callback(data)
    }).fail(err => {
        console.log('load error: ', err);
        callback({name: urlParams.get('name')})
    });

}


function pause() {
    paused = true;
}

function unpause() {
    if (paused) {
        paused = false;
    }
}

window.showScrollMessage = showScrollMessage;
window.showScrollDialog = showScrollDialog;
window.showInventoryDialog = showInventoryDialog;
