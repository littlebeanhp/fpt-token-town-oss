# FPT AI Token Factory Roadmap

Milestones 1 and 2 are complete, along with the locked city tour. Milestone 3 is implemented; real-GPU profiling remains pending. This roadmap covers the remaining product passes for the city experience.

## Milestone 2: Time-Lapse City (complete)

An accelerated city clock with a visible time indicator and pause, speed, and preset controls.

- The clock runs at 2.5 city minutes per real second at 1x, with 1x, 4x (default), and 12x speeds. A visit starts at 16:30, so the first minute runs through golden hour into dusk.
- The key light follows one continuous sun-and-moon path, so its direction never jumps at sunrise or sunset. The shadow frustum follows the focused district.
- Sky, fog, and hemisphere colors blend through art-directed keyframes for night, dawn, day, golden hour, dusk, and blue hour.
- A single night value drives building emissive intensity, window bands, street-lamp heads, lamp light pools, token intensity, and a warm storefront light on the focused district.
- Day, Dusk, and Night presets move the clock forward smoothly and hold it there until Play is pressed.
- The clock only advances inside the render loop, so it stops in hidden tabs. With reduced motion, the clock starts paused and presets jump instantly.

## Locked City Tour (complete)

The camera is locked to art-directed shots and never shows the edge of the world.

- The hub district on the middle block is the default and home stop. Previous and Next wrap through all seven districts, and so do the arrow keys and horizontal swipes. Escape and Home return to the hub.
- There is no free orbit, pan, or zoom. Clicking empty city keeps the current stop. Clicking a neighbouring building or its floating tag focuses it.
- The districts sit on a 10-unit block grid, surrounded by a compact 9×9 grid of 81 blocks extending 45 units in every direction. Fog relative to the camera fades the far city into the sky color.
- Left-column shots mirror the camera angle, so corner districts look back across the city instead of past its edge. The row nearest the camera stays low-rise so it never hides a district.
- Everything outside the focused block turns fully gray and slightly darker: factories, their glow, visitor crowds, trees, lots, and token lanes. Opacity is never used.
- A quarter-resolution Gaussian blur is composited using camera-space depth and screen distance, so same-depth neighbours soften too while the selected block stays sharp.
- Unit tests cast rays through every shot, several desktop and mobile viewports, and mid-transition poses. Every ray must point below the horizon and land inside the city or in fully opaque fog. They also check that no filler block or other district hides the focused plaza.

## Milestone 3: Vehicle Traffic (implemented)

Small low-poly cars and occasional bikes make the streets feel active.

- `VehicleAsset` separates model geometry, materials, rear-light anchors, night treatment, and cleanup from the simulation. `PrimitiveVehicleAsset` supplies compact hatchbacks and step-through bikes with riders; replacement assets use meters, Y-up, and +Z forward.
- `layout.ts` defines 49 looped right-hand lanes on the road grid. Arc-length sampling keeps speed constant through rounded turns and across the loop seam.
- Two or three evenly spaced vehicles share each lane's cruising speed, with restrained paint colors and size variations. Roughly 14% of vehicles are bikes. Vehicles, pedestrians, token flow, and core animation share the clock speed selector, so the default 4× accelerates all ambient motion. Lighting pause/presets still allow ambient movement; reduced motion freezes it.
- Vehicle components and short light trails use `TintedInstances`, shared geometry/materials, and pooled transforms. The update loop creates no temporary vectors, matrices, or arrays.
- Cars leave two small warm light trails; bikes leave one. The seven-segment trails start on the actual bulb faces at lamp height, taper in brightness, and follow the bulbs' rotated positions around corners. They stay faint in daylight and brighten with the same night value as headlights and the city lights.
- The lane around each block shares that block's focus emphasis, so vehicles and trails outside the focused district turn gray.
- Traffic more than two blocks from the focused stop pauses, with its trails hidden. Hidden tabs stop all traffic. Reduced motion freezes vehicles and removes trails.
- Unit checks cover loop continuity, speed and heading, full vehicle geometry clearance from sidewalks, focus tinting, distant/reduced-motion pausing, night lights, exact bulb/trail attachment, 4×/12× motion, and resource disposal.

Real desktop GPU profiling and physical mobile checks remain pending; software-rendered browser checks cannot establish hardware frame rates.

## Shop Waiting Lines

- All six model shops have compact serpentine waiting lanes with silver posts, dark caps, and sagging red ropes.
- The crowd and barriers share one layout, so visitors face along the line and the doorway, lane turns, and sidewalk entrance remain clear.
- Queue barriers use four instanced batches and follow the shop's focus tint. Unit checks verify queue capacity, road/building clearance, and unobstructed paths.

## Client Performance Pass

### Second pass: what the GPU is handed each frame

- Measured first. At the hub on a 1440x900 stage the city submitted 1.76M triangles over three geometry passes; the walking characters were about three quarters of it, because each one is instanced over a hundred times and drawn again into every shadow map.
- Rebuilt both walking characters from their sources at a far harder simplification: FPT 3,288 → 948 triangles (107 → 67 KB), Grab 3,594 → 1,776 (117 → 94 KB), with the split-leg rig, the animation channels and the baked liveries intact. `scripts/optimize-glb.mjs` carries this as the `character` preset.
- The night entrance spotlight no longer renders a shadow map in daylight. Parking it with `shadow.autoUpdate` rather than `castShadow` removes a whole geometry pass without recompiling a single material.
- Lamp posts left both shadow passes: 500 instances of geometry too slender to resolve in a 1024px map.
- The backdrop is built only on the 60 blocks a locked shot can reach. `isBlockInSight` is derived from the camera and held by a test that re-derives the visible set from every shot, orbit and transition.
- Parks hold five trees in a quincunx instead of nine on a grid, and the plaza rim five instead of nine: 39 trees down to 31.
- Result at the hub: 0.62M triangles over two passes in daylight and 0.91M over three after dark, down from 1.76M in every phase. Still a geometry budget, not a frame rate; real-GPU profiling remains pending.

### Startup

- The district houses, the character files and the optional modules are all requested while the renderer initialises, instead of being fetched one after another once the first view exists.
- The loading screen stays up until the city is ready and compiled, naming each chapter as it starts: renderer, city grid, model assets, trees and props, visitors, shaders. The pop-in of districts, props and crowds now happens behind the overlay instead of in front of the visitor.
- The overlay covers the stage, so it never outlives the city: a ready city clears it in the same frame even with chapters still queued behind a blocking compile, and thirty seconds clears it regardless. Left to pace itself it had stayed up past the ready city, leaving a dimmed, motionless view that ignored every click.

### First pass

- Reduced the city from 361 to 81 blocks, with 72 simple background houses. Distant windows, rooftop machinery, trees, lamps, and road details are removed; the outer city fades into camera-relative fog.
- Static city/shop geometry fell from 487,878 to 28,522 triangles before culling. Background houses use plain boxes and simple lighting without casting shadows.
- Replaced the multi-pass bokeh pipeline with two quarter-resolution Gaussian blur passes and a sharp, depth-aware composite. Blur radius stays stable as pixel density changes.
- Limited render density to 1.5 desktop / 1.25 mobile and 1.5 million pixels. Sustained slow frames reduce resolution gradually; sustained recovery restores it. HTML overlays keep native resolution.
- Reduced the directional shadow map to 1024px and tightened its coverage around the focused district.
- The starting core view renders before animated props are loaded. GLB support loads on demand; unused primitive geometry is no longer constructed. Fonts are self-hosted.
- Tests enforce geometry budgets, unobstructed/fog-covered camera views, and adaptive resolution. Physical-device profiling remains pending.

## Panel and Entrances

- The panel's outbound action is now `Explore more: Visit GPU farm`, pointing at the inference platform; the API request dialog it replaced is gone along with its styles and its browser check.
- People in town is simulated between 2,000 and 3,000, drifting once every thirty seconds. The presence Worker and its Durable Object stay deployed but the panel no longer reads from them.

## Town Guide

- Exactly one FPT character exists in town, and it is the guide: they stand still on the speech studio's plaza with an exclamation mark over their head, reading `! meet the creator` and linking to the maker's LinkedIn. A unit test keeps the livery theirs alone, so the mark always means the same person. The stop and the destination live together in `townHost`; the mark is an HTML anchor projected from the guide's head, hidden whenever it would leave the frame or cover a panel.
- A unit test keeps the guide clear of the queue ropes, the waiting line, all three runner lanes and the block's planting, so dressing or queue changes cannot leave them standing inside something.

## Milestone 4: Focused Factory Presentation

The locked tour covers most of this milestone. The remaining refinement:

- Replace the procedural queue with crowd sizes driven by real token usage once a verified data source exists.
- Tune blur strength and the focus band on real desktop GPUs and high-DPR phones.
- Consider a per-stop camera override for GLB assets that need a custom angle.
- Test focused shots on physical mobile devices.

## Verification

Each milestone should include:

- Production TypeScript/build checks.
- Browser checks for desktop and mobile framing.
- Pixel/render checks for the active scene.
- Interaction checks for selection, camera transitions, the city clock, and navigation.
- Performance profiling on a real desktop GPU after vehicles are added.

## Current State

- Milestone 1: complete.
- Milestone 2: complete.
- Locked city tour: complete.
- Milestone 3: implemented; real-GPU profiling pending.
- Milestone 4: mostly delivered by the locked tour; refinement planned.

Model context lengths, token usage, and API access remain placeholders until a verified catalog and service endpoint are supplied. Crowd sizes and token traffic are simulated.
