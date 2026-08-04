## Generic African vulture

This model represents a large, soaring, obligate scavenger—roughly a white-backed or Rüppell’s vulture—rather than every African vulture species. Nesting habitat and feeding dominance vary considerably among species.

### Model now

Use a large scavenging bird with:

- Carrion-only diet and no normal hunting
- Very long perception range
- Strong attraction to carcasses and feeding vultures
- Low movement-energy cost while searching
- High feeding competition and dominance
- Large daily search area
- Communal feeding and roosting
- Slow reproduction
- One offspring per breeding attempt
- Long parental dependency
- Strong nest-site fidelity

The existing carnivore feeding system can already create a non-hunting scavenger by leaving `preySpeciesIds` empty, as demonstrated by the corvid species. Vultures commonly congregate at carcasses, while some species breed and roost colonially.

### Required additions

#### Aerial movement

The current ground-based locomotion system cannot represent:

- Flight
- Thermal soaring
- High-altitude searching
- Rapid travel across large distances
- Terrain-independent movement

Add a generalized flight mode with altitude state, cheap soaring, costly takeoff and flapping, and reduced movement during poor thermal conditions.

#### Carcass discovery network

Vultures should find food through:

- Direct visual detection
- Watching other vultures descend
- Following circling or converging scavengers

This should create rapid, cascading congregation at newly discovered carcasses rather than requiring every bird to detect the carcass independently.

#### Feeding hierarchy

Different vultures specialize in opening carcasses or consuming different tissues. A generic version could use:

- Body size
- Dominance
- Beak strength
- Carcass accessibility
- Feeding position

Smaller vultures may have to wait until larger scavengers open or abandon a carcass.

#### Roosts and nests

The simulation currently lacks cliffs, tall trees and aerial nesting. Add persistent roost or nest sites that vultures return to after foraging. Rüppell’s vultures commonly nest on cliffs, while other African vultures use trees.

#### Slow life history

Vultures should mature slowly, reproduce infrequently and invest heavily in one chick. Several species form long-term pairs and raise only one or two chicks per breeding season.

### Current best approximation

With configuration alone, the engine can create a terrestrial scavenger that locates carcasses, feeds communally, competes for meat, reproduces slowly and never hunts.

**Config-only realism: 4/10.**

The major missing element is flight. Without aerial searching, soaring, communal roosts and long-range carcass discovery, it would behave more like a large ground scavenger than a convincing vulture.
