# FPT AI Token Factory

> **Open edition.** The original city uses district houses built from a purchased, non-redistributable
> asset pack. This repository leaves those out: every district is drawn from primitive shapes, and
> the street dressing and the animated characters are skipped. To use your own houses, set `assetUrl` on a model in
> `src/data/models.ts` (see [Replace a Factory With a GLB](#replace-a-factory-with-a-glb)).
> Asset provenance and licences are in [ASSETS.md](./ASSETS.md); the code is MIT.

See [ROADMAP.md](./ROADMAP.md) for the persisted plan. Milestones 1 and 2 and the locked city tour are complete. Milestone 3 vehicle traffic is implemented; real-GPU profiling remains pending.

A miniature AI city built with Next.js, TypeScript, imperative Three.js WebGPURenderer, TSL focus blur, GSAP, and React overlays. No React Three Fiber. The city combines procedural geometry with optimized GLB buildings, characters and trees.

## Run

```sh
npm install
npm run dev -- --port 3000
```

Open http://localhost:3000. Node 18.18+ runs the app; Node 22 LTS is recommended and is required for Cloudflare's Wrangler CLI. WebGPU needs a secure context (HTTPS or localhost). Three.js automatically uses its WebGL2 backend when WebGPU is unavailable.

To preview the production build, run `npm run build`, then `npm start`, and open http://localhost:3000.

## Deploy

The city renders on the client and `npm run build` writes its static assets to `out/`. A Cloudflare Worker and one SQLite Durable Object serve `/api/presence` for the shared live visitor count; no Node.js server runs in production.

### Cloudflare

One-time setup:

1. In the Cloudflare dashboard, create an API token from the **Edit Cloudflare Workers** template, and copy your **Account ID** from the Workers & Pages overview.
2. For automatic deploys, add both as GitHub repository secrets named `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` under Settings, Secrets and variables, Actions.

After that, every push to `main` runs the typecheck, unit tests, build, and deploy in `.github/workflows/deploy-cloudflare.yml`. **Run workflow** on the Actions tab redeploys by hand. Without the secrets, the workflow still checks and builds, then skips the deploy with a notice.

To deploy from your own machine, copy the credentials template and fill it in. `.env` is ignored by git and must never be committed.

```sh
cp .env.example .env
```

With Node 22 installed locally:

```sh
npm run deploy:cloudflare
```

On a machine whose Node is older than `.nvmrc`, deploy through a container instead. `scripts/deploy-docker.sh` copies the checkout to a temporary directory, then installs, builds, and deploys inside `node:22-alpine`, so no container-owned files land in your working tree. Extra arguments pass through to Wrangler.

```sh
npm run deploy:docker
npm run deploy:docker -- --dry-run   # build and validate without deploying
```

The site is served by a Workers static-assets project configured in `wrangler.jsonc`, at `https://fpt-token-town.<your-subdomain>.workers.dev`. Add a custom domain under the Worker's Domains & Routes settings. `public/_headers` sets long-lived caching for hashed assets and baseline security headers.

Cloudflare Pages also works: connect the repository with build command `npm run build` and output directory `out`.

### Docker, on any machine

```sh
docker compose up -d --build
```

Open http://localhost:8080. Without Compose:

```sh
docker build -t fpt-token-town .
docker run -d -p 8080:8080 --restart unless-stopped fpt-token-town
```

The image builds the export with Node 22 and serves it from unprivileged nginx on port 8080. `deploy/nginx.conf` adds gzip, one-year caching for hashed assets, no-cache HTML, and the same security headers. Browsers only allow WebGPU over HTTPS or on localhost, so a plain-HTTP address on a network falls back to WebGL2. Put the container behind an HTTPS reverse proxy or a Cloudflare Tunnel to keep WebGPU.

### Any static host

Upload the contents of `out/`, serve `404.html` for missing paths, and cache `/_next/static/` long-term.

## Locked City Tour

- The view opens focused on the hub district on the middle block, and is always locked to a stop. Dragging adjusts the view within a 30-degree horizontal arc (±15°); each new stop resets the angle. There is no free pan or zoom.
- Previous and Next move through the seven model districts and wrap at both ends. Arrow keys do the same; Escape, the house button, and the Home key return to the hub.
- Clicking a neighbouring building or its floating tag focuses it. Clicking empty city keeps the current stop.
- The districts sit on a 10-unit block grid inside a compact 9×9 city (81 blocks, 45 units in every direction). Camera-relative fog hides the outer edge on wide and tall views. Locked tour shots use a 1.25× close framing so the active model and its visitors dominate the view; left-column shots mirror the camera angle to look back across the city.
- Everything outside the focused block turns gray and slightly darker: other factories, their glow, visitor crowds, trees, lots, and token lanes. A stronger background blur follows camera depth and screen distance, while the focused district stays sharp.
- Each model shop has a dense serpentine queue between silver stanchions and sagging red ropes, its head at the house's own entrance. The loader finds that entrance rather than assuming one: the lowest front-facing pane of shopfront glass, lit or dark, is the way in, and the doorway lamp moves there so the opening the line walks into is the one that glows. Because a door is rarely centred, the whole serpentine mirrors to run its rows away from it, which keeps the first row full length on either side.
- How many people turn up follows the model's token burn. The counts span four orders of magnitude, so the share is taken on a log scale: the busiest district fills its line and runs all eighteen runners, the quietest keeps a short line and seven, and nobody is left standing alone. Mirroring only ever lengthens a path, so the line is scaled against a frontage-independent capacity and no house can out-queue a busier one by having a wider shopfront.
- Every 0.5 seconds the line takes one short step: the front visitor walks through the doorway and stays indoors until the next exchange; the previous indoor visitor exits, while one returning runner rejoins the back. Runners use three staggered routes around each building and nobody disappears. Waiting legs rest between steps; walking and running strides follow actual travel distance. Some visitors wear their district's brand color, and the supplied Grab rider appears only among stationary bystanders or mounted on road bikes.
- The animated Grab and FPT characters (three instanced parts each, split-leg walk cycles sampled from distance travelled) are not shipped in the open edition: without their GLBs every visitor and the guide are voxel people, and Grab riders do not appear on the road. Drop `grab-walk-v2.glb` and `fpt-walk-v2.glb` into `public/models/` to bring them back; `CHARACTER_SPECS` in `src/experience/world/Crowd.ts` names the expected node layout.
- That one FPT visitor is the town guide: they stand on the speech studio's plaza with an exclamation mark over their head linking to the maker's LinkedIn. `townHost` in `src/data/models.ts` holds both the stop and the destination; the mark is an HTML anchor in the label layer, projected from the guide's head every other frame and hidden whenever it would leave the frame or cover a panel.
- Original GLB authoring exports live under the gitignored `.local-assets/glb/` folder. Only optimized runtime copies belong in `public/models/`.

## Time-Lapse City (Milestone 2)

- An accelerated city clock with a visible time and phase, pause/play, 1x/4x/12x speeds, and Day, Dusk, and Night presets. Presets move the clock forward smoothly and hold it until Play is pressed.
- The sun and moon share one continuous light path. Sky, fog, and ambient colors blend through night, dawn, day, golden hour, dusk, and blue hour.
- A single night value drives building windows, street lamps and their light pools, token intensity, and a warm light on the focused district. The page theme follows the city after dark.
- Directional lighting dominates the sky fill for clear light/shadow separation. Night sky fill keeps unlit architecture readable. Each central block has four capped lanterns with pedestal bases and slender posts; the focused block uses four point lights with a six-unit range, plus a shadow-casting entrance spotlight. Shared lamp offsets keep visible bulbs and real light sources aligned. Distant lamp geometry and wider ground glows remain instanced.
- The clock stops in hidden tabs. With reduced motion it starts paused, presets jump instantly, and camera moves are immediate.

## Vehicle Traffic (Milestone 3)

- Compact low-poly cars and occasional bikes cruise the road grid on rounded, evenly spaced loops.
- Each road loop includes a motorbike carrying the existing textured Grab GLB in a fixed riding pose. Body and legs reuse the already-loaded asset in three instanced batches; only the bike uses primitive geometry, with no extra asset download. Cars leave two short, fading warm light trails; bikes leave one. Trails start at the actual rear bulb faces at lamp height, follow the bulbs through turns, stay subtle by day, and brighten at night with the headlights.
- Vehicles and trails share their block's focus tint. Distant traffic pauses; reduced motion freezes vehicles and hides trails. The 1×/4×/12× speed control now drives vehicles, pedestrians, token flow, and the core animation together; the default 4× gives the whole city a time-lapse pace. Clock pause and day/night presets hold the lighting while ambient movement continues; reduced motion freezes everything.
- `VehicleAsset` is the model-replacement boundary: provide shared component geometry/materials, exact rear-light positions and colors, night treatment, and cleanup. `Traffic` accepts car and bike assets and owns their instanced rendering and movement. Models use meters, Y-up, +Z forward, and tires at ground level.

## Milestone One

- Six distinct factory silhouettes, an animated central token router, and instanced props.
- Raycast selection, 1.45-second interruptible camera transitions, and model navigation.
- TSL depth-aware focus blur with smoothly tracked camera-space focus distance. Opacity is never used for focus.
- Bidirectional instanced cube traffic along CatmullRomCurve3 paths.
- Responsive HTML model panels, projected labels, accessible controls, and a link out to the GPU farm.

Model context lengths are explicitly unverified; token usage, crowd sizes, traffic and the people-in-town figure are all simulated. No credentials or external inference calls are included.

## Organization

| Path                        | Responsibility                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `src/experience/core`       | Renderer lifecycle, tour selection, raycasts, pooled resources, focus tinting           |
| `src/experience/world`      | City grid and layout, core, crowds, vehicles, city clock, lighting, factory object      |
| `src/experience/camera`     | Locked shots, lens shift framing, and interruptible transitions                         |
| `src/experience/effects`    | TSL quarter-resolution blur and sharp-focus composite with a screen-space focus falloff |
| `src/experience/simulation` | TokenSimulation contract and CPU instanced implementation                               |
| `src/experience/loaders`    | Factory and vehicle asset implementations, common factory anchor/material behavior      |
| `src/components`            | React overlays, tour controls, time-lapse controls, and the city directory              |
| `src/data`                  | Model catalog, tour order, and framework-free clock helpers                             |
| `src/types`                 | Asset and application contracts                                                         |

## Replace a Factory With a GLB

Place an asset in `public/models/` and set its model's `assetUrl` in `src/data/models.ts`, for example `assetUrl: '/models/deepseek.glb'`. `Factory.create()` picks the loader. Camera, selection, token simulation, and UI only use `FactoryAsset`; none of those systems depend on BoxGeometry.

Author GLBs in meters, Y-up, with the ground at Y=0, a centered origin, and a footprint of approximately 5.6 by 4.6 units. Apply transforms before exporting. Use glTF standard/PBR materials for consistent focus and night treatment.

```text
ROOT
  VISUAL
  COLLIDER
  CameraAnchor
  CameraTarget
  TokenInput
  TokenOutput
  UIAnchor
```

`COLLIDER` can contain multiple simplified meshes; they are hidden from rendering and explicitly raycast. Without a collider, visible meshes are used. Named anchors are preserved and returned in world space. Missing anchors get generated defaults based on the factory height and standard district footprint. The locked camera uses CameraTarget for its height and the asset's bounding sphere for framing; the city chooses the camera direction so no shot can leave the city. CameraAnchor stays in the contract for custom tooling but no longer steers the tour. Keep the building's front facing +Z, where the visitor queue forms. The common asset implementation owns emphasis/night changes; the loader owns geometry, material, and texture cleanup. Failed model loads show a recoverable error.

Model positions in `src/data/models.ts` place each district on a block of the 10-unit grid, 0.9 units behind the block centre. The array order is the tour order after the core.

## Simulation and Performance

`TokenSimulation` exposes `root`, `update(delta, elapsed)`, `setNight`, `setEmphasis`, and `dispose`. A future TSL compute implementation can replace `CPUTokenSimulation` without altering the scene, factory, camera, or UI interfaces. Input/output positions sit on sidewalk rims, and routes follow streets to the reserved public square; curves are created once when assets load.

Geometry and materials are reused per resource owner. Filler buildings, window bands, lots, road markings, lamps, light pools, trees, token cubes, vehicle parts, light trails, queue ropes and posts, and every body part of the crowd are instanced. `TintedInstances` stores each instance's base color and city block, and rewrites instance colors only while focus emphasis is changing. Vehicles and their trails use the same batches. Crowd, vehicle, and token updates reuse scratch vectors, quaternions, and matrices and allocate nothing per frame. GPU pixel density is capped at 1.5 on desktop and 1.25 on mobile, with a 1.5-million-pixel frame budget and gradual adaptive scaling. Animation and the city clock pause in hidden tabs, and reduced-motion preferences stop ambient animation, pause the clock, and remove camera transition motion. Shadows use one directional light with a 1024px map whose frustum follows the focused district. The night entrance spotlight does cast one, but its shadow map is parked (`shadow.autoUpdate = false`) whenever the city reads as daylight, which removes a whole geometry pass without touching `castShadow` and therefore without recompiling any material. Lamp posts are too slender to resolve in a 1024px map and stay out of both shadow passes.

The city shows an initial core view before downloading the crowd, queue, vehicle, and token modules. Downloads start before the graphics device is ready: the optional modules, the five district houses (`preloadHouses`) and the two character files (`Crowd.preload`) are all requested while `WebGPURenderer.init()` runs, so they arrive in parallel instead of queueing behind the first city view. The loading screen stays up for the whole sequence and names each chapter it reaches — renderer, city grid, model assets, trees and props, visitors, shaders — so the fill-in happens behind the overlay rather than in front of the visitor. Because it covers the stage it also swallows clicks, so it is never allowed to outlive the city: shader compilation blocks the main thread for seconds at a time and chapters queue up behind it, but a ready city clears the overlay in the same frame, and a city that never reports itself ready clears it after thirty seconds regardless. Tour controls become available after the districts are prepared. The optional GLB loader is fetched only when a model has an `assetUrl`. Shared primitive resources create geometry only when used. DM Sans and Manrope variable font subsets are served locally, with their OFL licenses in `public/fonts/`; there are no Google Fonts requests on the client.

Background lots use one simple, shadow-free house each, with no bevels, rooftop machinery, or repeated window grids, and only on the 60 blocks a locked shot can actually reach: `isBlockInSight` drops the +X column, the +Z row and the far corners behind the camera, because no shot, orbit or transition frames them even with a three-unit margin and eight units of fog slack. Street markings and lamps are limited to the central neighbourhood. All district trees use alternating instanced `pin-tree-v1.glb`, `tree-v1.glb`, and `quaternius-tree-v1.glb` assets loaded after the first city preview. Two quarter-resolution Gaussian passes replace the multi-pass bokeh effect; a depth/screen mask composites the focused block at the scene's full resolution.

Each model building has three trees close to its sides: one left and two right, with seeded variations in position, height and rotation. The parks hold a quincunx of five rather than a full 3x3 grid, and the plaza's rear rim carries five spaced trees instead of a hedge of nine. All 31 trees sit in white square planters with inset soil; both plants and planters receive scene lighting and cast shadows. Lantern bulbs use a smaller luminous mesh while their emission and real light output stay unchanged.

The static city plus six shop models dropped from 20,222 placed instances / 487,878 triangles to 1,835 / 28,522, counted before culling. Counting what the GPU is actually handed each frame, at the hub on a 1440x900 stage: 1.76M triangles over three geometry passes before, 0.62M over two in daylight and 0.91M over three after dark. Most of that came from the walking characters, which are instanced over a hundred times and drawn again into every shadow map. This is a geometry budget, not a measured frame rate. Unit tests enforce the smaller backdrop budget, fog coverage through camera transitions, and adaptive-resolution limits. 60fps remains a target requiring validation on real GPUs; software browser checks establish correctness, not hardware performance.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm exec playwright install chromium
# With the application running:
node scripts/browser-check.mjs
# Force the WebGL2 fallback through the same tests:
FORCE_WEBGL=1 node scripts/browser-check.mjs
# Check progressive startup against the matching local out/ build:
node scripts/startup-check.mjs
```

Unit tests cover the asset contract, glTF loading, the city clock and lighting continuity, per-block graying, the locked camera, and vehicle lane continuity, sidewalk clearance, focus tinting, motion preferences, night lights, lamp-to-trail attachment through turns, time-lapse speed, queue clearance, and cleanup. `city-sight.test.ts` re-derives the visible set of blocks from the camera itself and fails if any shot, orbit or transition reaches a block the city leaves empty, or if the backdrop quietly grows back to the full grid. `town-host.test.ts` keeps the plaza guide clear of the ropes, the waiting line, all three runner lanes, and the block's trees and planters. The camera tests cast rays through every shot, several desktop and mobile viewports, and mid-transition poses. Every ray must point below the horizon and either land inside the city or reach fully opaque fog, and no filler block or other district may hide the focused plaza.

The browser script checks nonblank pixels, changing animation, the core default, wrapping Next/Previous, keyboard navigation, locked background clicks, tag and raycast selection, time-lapse pause/play/speed, day/dusk/night presets, the GPU farm link, mobile overflow, and rapid navigation. Screenshots are written to `test-results/`. Linux CI uses software Vulkan flags for WebGPU; test runs on a real GPU should omit those flags. `TEST_URL` can point to another server, `TEST_DPR=0.5` lowers render resolution for slow software GPUs while preserving desktop/mobile CSS framing, `TEST_TIMEOUT` raises or lowers the per-step ceiling (ten minutes by default, because a software WebGPU adapter needs about five to compile and build the textured city), and `HEADED=1` enables a visible browser when a display is available.

The PostCSS override applies a security fix to Next.js 15's transitive dependency. Keep the lockfile checked in. The bundled local fonts use system fonts as their loading fallback.

The interface is a full-viewport city with compact glass panels, an overlaid title, Previous/Next navigation and time controls. The old header, model dock and footer have been removed. Each panel carries the model's reported usage for the week, its context length and its catalog price; the city directory lists all seven, busiest first. Speech is metered in characters and everything else in tokens. A model with no catalog entry yet reads "Not available" rather than carrying a guessed price. A small link in the top right opens the serverless inference catalog on the platform itself.

The Quaternius archive stays in gitignored `.local-assets/glb/`. `scripts/convert-quaternius-tree.mjs` extracts the lightest FBX tree and bakes bark/leaf colors into one material; the simplified, quantized runtime GLB is 40.6 KB / 881 triangles. Planters and soil use two shared instance batches across all tree variants. Rear corner lanterns are omitted.

### Public square, panel and presence

Model panels show Hosted by FPT, separate price and in/out units, and an illustrative random 90–93% cached rate assigned to each LLM in the catalog (speech is excluded). Token lanes plug into the front sidewalk rims and follow roads to the public square on block (-1, 0), reserved for a future FPT core. DeepSeek remains the home camera stop.

People in town is a simulated figure, like the queue sizes and the token traffic: it starts somewhere between 2,000 and 3,000 and drifts by a bounded step every thirty seconds, so the panel reads as a busy city without claiming to have counted anybody. The `/api/presence` Worker and its Durable Object are still deployed and still count real browsers, but the panel no longer reads from them.

After building, run `npx wrangler dev --port 8787`, then `node scripts/presence-check.mjs` to check independent browsers, multiple tabs, heartbeats and departures against the real local Durable Object. `npm run deploy:cloudflare` deploys both static assets and the Worker, provisioning the presence binding through the migration in `wrangler.jsonc`.
