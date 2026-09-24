each floor fragment is a polygon with potentially one or more holes in it. for saving purposes, they will be split right down the line for each map section, so they can stream continuously along with everything else. during loading, any new fragment that shares at least two vertices with an already-loaded fragment should be joined to the existing fragment into one continuous surface. 

*properties*
a fragment has:
 - a polygon shape
 - texture. this can be split into 1024x1024px sub-textures if the fragment is large enough
 - a collection of contents: things that currently reside on that fragment. these could be trees, powerups, walls, npcs or anything else. any game object has to be attached to a floor fragment.
 - a base level, which is just the z value of the fragment in map units. we can round this to the nearest integer. 0 is ground level.
 - a mesh, which may be flat if the fragment is flat, but can also have arbitrary slopes that can change elevation (such as hills or ramps)
 - transition lines. this would be a line where, by crossing it, you transition to another fragment. examples: from a lower level to a staircase or ramp and then to the level above, a portal, or walking off the edge of a roof.

*rendering*
fragments render as 3d meshes, just like anything else. any fragment which is above the player's fragment and visually intersects it doesn't get rendered at all, and neither does anything on it. this rule extends to any fragment that's above and intersects any fragment hidden in this way, ad infinitum.

*buildings*
a building is formed using the building polygon tool. one polygon is placed at the building height, then another is placed 0.001 map units above ground level to form the floor of the building. in this way, it's possible to pick up and move the entire thing as one unit and also to set the floor texture at the bottom floor with a double-click. the second floor can either be a second floor or a roof. the whole building (architectural elements only) can be batched into a single geometry object and rendered as one thing, skipping any items inside.

*roofs* roofs are just floor fragments with roof-like textures and roof-shaped geometry. that means you can walk around on them, potentially.