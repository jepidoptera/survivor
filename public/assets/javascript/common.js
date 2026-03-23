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

function prepareModalInteraction() {
    if (typeof globalThis !== "undefined" && typeof globalThis.exitGameplayPointerLock === "function") {
        globalThis.exitGameplayPointerLock();
    }
}

function msgBox(title, text, buttons = [{text: "ok", function: () => {}}]) {
    prepareModalInteraction();
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
    prepareModalInteraction();
    if (pause) pause();
    msgBoxActive = true;
    const safeText = String(text === undefined || text === null ? "" : text);
    const safeTitle = String(title === undefined || title === null ? "" : title).trim();
    const $box = $("#msgbox");
    $box
        .removeClass("dialogBox")
        .addClass("scrollMessageBox")
        .empty()
        .show();
    if (safeTitle.length > 0) {
        $box.append(
            $("<div>")
                .addClass("scrollMessageTitle")
                .text(safeTitle)
        );
    }
    $box
        .append(
            $("<div>")
                .addClass("scrollMessageContent")
                .append(
                    $("<div>")
                        .addClass("scrollMessageText")
                        .text(safeText)
                )
        )
        .append(
            $("<div>")
                .attr("id", "msgbuttons")
                .addClass("scrollMessageButtons")
        );
    $("#msgbuttons").append(
        $("<button>")
            .addClass("msgbutton scrollMessageButton")
            .text(String(buttonText || "ok"))
            .click(() => {
                $box.hide().removeClass("scrollMessageBox").addClass("dialogBox");
                unpause();
                msgBoxActive = false;
            })
            .attr("type", "submit")
    );
    return $box;
}

function clearDialogs() {
    $("#msgbox").hide().removeClass("scrollMessageBox").addClass("dialogBox");
    $("#optionsMenu").hide();
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
