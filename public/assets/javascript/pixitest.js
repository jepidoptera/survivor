const app = new PIXI.Application({width: screen.width, height: screen.height});
let bear;

// app.stop();

let mapTileWidth = screen.width / 20;
let mapTileHeight = screen.height / 13;

let textures = {};

class Animal {
    constructor(type, textures, x, y) {
        this.type = type;
        this.x = x;
        this.y = y;
        this.textures = textures;
        this.img = new PIXI.Sprite(textures[0]);
        this.img.x = x;
        this.img.y = y;
        this.xmove = 5;
        this.ymove = 0;
    }
    move() {
        this.x += this.xmove;
        this.y += this.ymove;
        if (this.x > $("#display").width()) {
            console.log('left the screen');
            this.xmove = -Math.abs(this.xmove)
        }
        else if (this.x < 0) {
            this.xmove = Math.abs(this.xmove);
        }
        this.img.x = this.x;
        this.img.y = this.y;
        if (this.xmove > 0) {
            this.img.texture = this.textures[1]
        }
        else {
            this.img.texture = this.textures[0]
        }
    }
}

PIXI.Loader.shared
    .add('/assets/spritesheet/bear.json')
    .load(onAssetsLoaded);

function onAssetsLoaded() {
    // create an array to store the textures
    let bearSprites = ["bear_walk_left", "bear_walk_right", "bear_attack_left", "bear_attack_right"];
    let sheet = PIXI.Loader.shared.resources["/assets/spritesheet/bear.json"].spritesheet;

    textures['bear'] = [];
    for (let i = 0; i < bearSprites.length; i++) {
        const texture = sheet.textures[`${bearSprites[i]}.png`];
        textures['bear'].push(texture);
    }

   $("#display").append(app.view);

    // create a new Sprite from an image path
    // const bear = PIXI.Sprite.from('/assets/images/animals/bear.png')
    bear = new Animal('bear', textures['bear'], 512, 512);
    bear.img.width = mapTileWidth;
    bear.img.height = mapTileHeight;
    
    // center the sprite's anchor point
    bear.img.anchor.set(0.5);
    
    app.stage.addChild(bear.img);
    
    // Listen for animate update
    app.ticker.add((delta) => {
        // just for fun, let's rotate mr rabbit a little
        // delta is 1 if running at 100% performance
        // creates frame-independent transformation
        // bear.rotation += 0.1 * delta;
        // bear.img.x += bear.xmove;
        // bear.img.y += bear.ymove;
        // if (bear.x < bear.img.anchor.x * bear.width || bear.x > app.screen.width - bear.img.anchor.x * bear.width) {
        //     bear.xmove = -bear.xmove;
        // }
        bear.move();
    });

}


$(document).ready(() => {

    // // create a new Sprite from an image path
    // const bear = PIXI.Sprite.from('/assets/images/animals/bear.png');
    
    // // center the sprite's anchor point
    // bear.anchor.set(0.5);
    
    // // move the sprite to the center of the screen
    // bear.x = app.screen.width / 2;
    // bear.y = app.screen.height / 2;
    
    // app.stage.addChild(bear);
    
    // // Listen for animate update
    // app.ticker.add((delta) => {
    //     // just for fun, let's rotate mr rabbit a little
    //     // delta is 1 if running at 100% performance
    //     // creates frame-independent transformation
    //     bear.rotation += 0.1 * delta;
    // });

    
})

var size = [1080, 1080];
var ratio = size[0] / size[1];
resize();

function resize() {
    let w = $("#display").width();
    app.view.style.width = w + 'px';
    app.view.style.height = w + 'px';
}
window.onresize = resize;