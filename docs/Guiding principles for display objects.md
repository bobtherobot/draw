
# Guiding principles for display objects (shapes, text, etc)

When we initially create an object (on the stage), we should establish and initialize:

## The literal object
The object created and rendered to the stage.

## An overlay object
A POJO (or class) that acts as controls to provide translation, scale, origin, rotation, and any other kind of transformation we may introduce in the future. This provides the visual controls for transformations and also acts as the visual cue that for which object we are operating on. It's z-index will always be on top of the literal object on the stage.

This may or may not render immediately, depending on the kind of display object.

## An abstract object
POJO (or class) that is purely mathmatical in nature (never rendered), which recieves the "select" and mouse instructions (position, hover, etc), and performs all the mathematical operations for moving, scaling, rotating, origin postion, and any other transformation we may introduce in the future. 

As the mathematical calculations are completed, they will be transmitted to the associated literal object and overlay object.

The abstract object is the "source of truth" and acts as the reference object when information such as x, y coordinates, rotation, origin, scale, width, height, or any other attribute we may introduce in the future (e.g. fill, stroke, color, shadow, blur, etc).

The abstract object also maintains current state, previous state and perhaps projected state -- or intermediary "operational" state to use as a reference for operations that require things like "start point", or meta key input for constraints, or other alternate affects.

Since any tool may perform operations on a display object, the operations would funnel through the abstract object.

## Auxiliary objects (as needed)
Some display objects may need additional features when selected or hovered over, for example: free-text objects can have a baseline line and a text-alignment indicator on the baseline.

Some times we may need a thin outline to indicate when a display object is hovered over.

Some tools (that we indroduce in the future) may need to render special controls.

And we may want to move the origin crosshair into this aux object.