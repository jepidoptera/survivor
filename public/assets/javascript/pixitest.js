const app = new PIXI.Application();
const bears = [];

// app.stop();

class Animal {
    constructor(type, x, y) {
        
    }
}

PIXI.Loader.shared
    .add('/assets/spritesheet/bear.json')
    .load(onAssetsLoaded);

function onAssetsLoaded() {
    // create an array to store the textures
    let bearSprites = ["bear_walk_left", "bear_walk_right", "bear_attack_left", "bear_attack_right"];
    let sheet = PIXI.Loader.shared.resources["/assets/spritesheet/bear.json"].spritesheet;

    for (let i = 0; i < bearSprites.length; i++) {
        const sprite = new PIXI.Sprite(sheet.textures[`${bearSprites[i]}.png`]);
        bears.push(sprite);
    }

    document.body.appendChild(app.view);

    // create a new Sprite from an image path
    // const bear = PIXI.Sprite.from('/assets/images/animals/bear.png')
    let bear = bears[0];
    
    // center the sprite's anchor point
    bear.anchor.set(0.5);
    
    // move the sprite to the center of the screen
    bear.x = app.screen.width / 2;
    bear.y = app.screen.height / 2;
    

    app.stage.addChild(bear);
    
    // Listen for animate update
    app.ticker.add((delta) => {
        // just for fun, let's rotate mr rabbit a little
        // delta is 1 if running at 100% performance
        // creates frame-independent transformation
        // bear.rotation += 0.1 * delta;
        
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
