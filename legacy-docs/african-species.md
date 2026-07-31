Assuming **“water buffalo” means African buffalo/Cape buffalo (*Syncerus caffer*)**, not the Asian water buffalo.

## Architectural assessment

The current engine can already model generic differences in body size, speed, metabolism, hydration, aging, reproduction, parenting, genetics, perception radius, diet, prey species, migration tendency, individual territory, social attraction, alarm propagation, hunting, injury, disease, and carcass feeding. Adding a species that uses those existing behaviors is primarily configuration work. 

However, these eight species expose several missing **general-purpose mechanics**:

1. **Distinct forage guilds**

   * Short grass
   * Tall/coarse grass
   * Woody browse
   * Fruit or point resources

2. **Persistent social organizations**

   * Zebra family bands
   * Elephant families
   * Lion prides
   * Hyena clans
   * Male coalitions and bachelor groups

3. **Cooperative interactions**

   * Group hunting
   * Herd mobbing
   * Collective calf defense
   * Recruitment to fights or carcasses

4. **Size-aware prey selection**

   * A leopard should hunt a wildebeest calf, not a healthy adult.
   * Lions may hunt adult buffalo, but with substantial risk.
   * Adult elephants and rhinos should generally be ineligible prey.

5. **Group territory and resource possession**

   * Pride/clan territories
   * Shared kills
   * Carcass theft
   * Communal dens

6. **Habitat-specific behavior**

   * Ambush cover
   * Trees and climbing
   * Browsing
   * Waterhole congregation
   * Seasonal and diurnal activity

**These should be generalized engine capabilities, never species-name conditionals.**

## Summary

| Species         | Current architecture fit | Realism using config only | Main missing mechanics                                        |
| --------------- | -----------------------: | ------------------------: | ------------------------------------------------------------- |
| Wildebeest      |                     High |                      7/10 | Seasonal mass migration, synchronized calving, mixed herds    |
| Zebra           |                   Medium |                      5/10 | Stable family bands, bachelor groups, coarse-grass grazing    |
| Elephant        |                      Low |                      3/10 | Matriarchal families, browsing, trees, musth, engineering     |
| African buffalo |                     High |                      7/10 | Mobbing, herd rescue, sex/age group structure                 |
| Black rhino     |              Medium-high |                      6/10 | Woody browse, sex-specific territory, charging                |
| Spotted hyena   |                      Low |                      4/10 | Clans, inherited rank, group hunts, kill theft                |
| Lion            |               Low-medium |                      4/10 | Prides, coalitions, cooperative hunts, communal parenting     |
| Leopard         |              Medium-high |                      6/10 | Trees, kill caching, ambush-cover effects, predator avoidance |

---

# Species models

## Wildebeest

### Model now

Use a large-bodied grazer with:

* Strong `migration.tracksForage`
* Large, loose social groups
* Strong alarm propagation
* High movement endurance
* Moderate-to-high water need
* Fast juvenile development
* Single calves
* Strong mother-calf following
* Moderate predator defense from herd size
* Male competition and size-based mate preference

The existing forage-gradient migration, herd labels, alarms, parenting, seasonal vegetation, hydration, and reproduction systems fit wildebeest reasonably well.

### Required additions

**Seasonal reproduction** should produce a compressed rut followed by synchronized calving. Wildebeest reproduction and calving are strongly seasonal, and calves quickly become mobile.

The current migration mechanism would model **nomadic forage tracking**, not a convincing Serengeti-style circuit. Real migration responds to large-scale, shifting rainfall and forage gradients and involves collective movement across a landscape much larger than local perception.

Add:

* Seasonal reproductive windows
* Birth synchrony
* Larger-scale forage-gradient commitment
* Mixed-species association with zebra
* Temporary male rut territories rather than permanent year-round territory

**Current best approximation:** plausible resident or locally migratory wildebeest, not the Great Migration.

---

## Plains zebra

### Model now

Use:

* Large body mass
* High endurance
* Strong hydration requirement
* Lower food selectivity than wildebeest
* Strong social attraction
* Strong parent-offspring attachment
* High vigilance
* Moderate predator defense
* Migration tied to forage and water

### Major limitation: social organization

Plains zebra do not merely form interchangeable herds. Their society contains relatively stable breeding units—typically a stallion, mares, and offspring—alongside bachelor groups. Zebra social structure is substantially more persistent than the engine’s current locally propagated herd labels.

Add a generalized persistent `SocialGroup` model supporting:

```text
family band
bachelor group
temporary herd aggregation
```

A zebra family band should:

* Retain membership when temporarily separated
* Have a resident stallion
* Keep mares and offspring together
* Expel or disperse maturing males
* Merge visually with other bands without losing identity

### Major limitation: feeding

The existing single vegetation-biomass field cannot represent zebra processing taller or coarser grass while wildebeest preferentially exploit shorter, higher-quality regrowth. Zebra and wildebeest frequently associate, but their movements also reflect competition and different forage use.

Add at least:

```text
grass biomass
grass height/maturity
grass nutritional quality
```

Zebra should tolerate tall grass and reduce its height; wildebeest should favor shorter regrowth.

---

## African elephant

### Model now

You could approximate elephants as:

* Extremely large mixed-feeding herbivores
* High energy and water requirements
* Long-lived
* Slow reproduction
* Long juvenile dependency
* Strong parent defense
* Large perception and memory capacity
* Trail creators
* Wide-ranging during shortages

But this would capture only their physiology, not their defining social ecology.

### Required additions

#### Matriarchal family structure

Savanna elephant families consist of related adult females and offspring, normally coordinated by a matriarch; social knowledge and long-term memory materially influence group decisions.

You need:

* Persistent multigenerational family groups
* A group leader
* Group decisions influenced by the leader’s memories
* Female philopatry
* Male dispersal into solitary or bachelor states
* Recognition between related family groups
* Allomothering or at least group calf protection

#### Woody vegetation

Elephants consume browse and physically alter woody vegetation. Their effects on tree abundance and structure are a major part of their ecological role.

With only grass biomass and generic cover, elephants cannot behave realistically. Add:

* Woody-browse biomass
* Individual trees or shrub patches
* Branch removal
* Tree damage or toppling
* Vegetation conversion toward open ground
* Optional water-digging or enlargement of water access

#### Male musth

Adult males should periodically enter a musth-like state:

* Increased mate seeking
* Increased movement
* Increased aggression
* Reduced tolerance of rival males
* Elevated dominance

**Elephants require the most substantial new infrastructure of the eight species.**

---

## African buffalo

### Model now

African buffalo fit the existing engine relatively well:

* Large grazing herbivore
* Strong water dependence
* Large, fluid herds
* Strong alarm behavior
* High adult body mass
* Long juvenile dependency
* Male competition
* Low adult predation vulnerability
* Strong group-defense modifier

Buffalo grouping is fluid and can show fission–fusion dynamics, which the existing local herd-label mechanism can approximate reasonably well.

### Required additions

#### Active mob defense

Current cooperative defense mostly reduces predator success passively. Buffalo need a real counterattack behavior:

```text
detect distressed herd member
→ nearby adults converge
→ surround or charge predator
→ predator retreats or risks injury
```

Buffalo antipredator behavior includes aggression as well as flight, and group configuration is central to defense.

Add generalized actions:

* `rally`
* `mobThreat`
* `chargeThreat`
* `guardCalf`

#### Sex- and age-structured grouping

Model:

* Female/calf core herds
* Adult bull associations
* Older solitary or peripheral bulls
* Calves moving toward group centers under threat

#### Forage

Buffalo should tolerate coarse grass and be strongly associated with water, but the single vegetation pool cannot distinguish their niche from wildebeest. Habitat quality materially affects buffalo grouping and movement.

**Buffalo would be one of the best early additions after implementing mobbing.**

---

## Black rhino

### Model now

Use:

* Solitary or loosely social behavior
* Very large body mass
* Low reproduction rate
* Long mother-calf association
* Strong individual home range
* Territorial adult males
* High boldness and defensive aggression
* Limited predator vulnerability
* Strong waterhole memory
* Scent marking

The current individual claim grid, home ranges, parenting, memory, and dominance systems are a good architectural match. Black rhinos are generally solitary, but social overlap varies, and male territoriality is particularly important.

### Required additions

#### Browsing

Black rhinos are browsers, not grass-dependent grazers. Without woody vegetation, their core feeding behavior cannot be represented.

Add:

* Shrub browse
* Tree browse below a reachable-height threshold
* Selective feeding from dispersed point or patch resources

#### Sex-specific territory

The current territory configuration appears species-wide. A realistic implementation needs:

* Adult males: defend individual territories
* Females: overlapping home ranges without equivalent territorial defense
* Juveniles: remain with mother
* Dispersing subadults: avoid dominant males

#### Charge response

A threatened rhino should sometimes countercharge rather than simply flee or defend abstractly.

#### Sensory modalities

A generic perception radius cannot represent relatively weak visual resolution combined with strong olfactory and auditory detection. A later generalized sensory model could separate:

```text
vision
hearing
scent
```

**Without browse, a black rhino would be behaviorally plausible but ecologically misplaced.**

---

## Spotted hyena

### Model now

A crude approximation could use:

* Carnivore with both hunting and scavenging
* High endurance
* Strong territoriality
* Large social groups
* Alarm propagation
* High boldness
* Broad prey list
* Burrow-centered parenting

That would resemble generic social carnivores, not spotted hyenas.

### Required additions

#### Persistent clans and matrilines

Spotted hyenas live in clans containing multiple matrilines, with long-term rank affecting resource access and fitness.

The existing dominance model is derived from current body condition, mass, and temperament. That is unsuitable for hyena rank, which needs:

* Persistent social rank
* Maternal rank inheritance
* Female dominance
* Female philopatry
* Male dispersal
* Individual recognition
* Rank-sensitive access to food

#### Cooperative hunting

Current hunting resolves an individual predator’s attempt. Hyenas require:

* Shared target selection
* Recruitment
* Multiple pursuers
* Coursing rather than stalking
* Capture probability based on participating hunters
* Shared feeding with rank-based access

#### Clan territory

Territory currently belongs to an individual claimant. Hyena territories belong to clans and can be defended cooperatively through patrols and inter-clan conflict.

#### Kill possession and theft

The simulation needs carcass possession and competitor assessment:

```text
owner group
nearby competitors
combined group strength
challenge / wait / abandon / fight
```

This would also support lion–hyena competition.

**Hyenas should not be introduced as a config-only species; their core behavior requires a persistent-clan system.**

---

## Lion

### Model now

A config-only lion would become:

* A large territorial stalker
* Strong enough to attack large prey
* Socially attracted to conspecifics
* Capable of parent defense
* Dominant at carcasses

It would still behave primarily like several adjacent independent predators.

### Required additions

#### Prides and coalitions

Lion society requires at least two persistent group types:

* Female-centered pride
* Male coalition

Female pride members are commonly close relatives, while male coalitions may consist of relatives or unrelated partners.

Add:

* Sex-specific dispersal
* Pride membership
* Coalition membership
* Shared pride territory
* Male takeover
* Optional infanticide as a later system

#### Cooperative hunting

Lion group hunts involve differentiated participation rather than every lion independently attacking the nearest prey.

A useful abstraction:

```text
group selects target
→ some hunters flank
→ some pursue
→ target is driven toward another hunter
→ group capture chance rises
```

It does not need sophisticated formation AI. It does require a shared target and spatially distinct roles.

#### Communal parenting

Lionesses should:

* Tolerate or provision pride cubs
* Defend related cubs
* Synchronize births to some degree
* Keep cubs around pride centers or den sites

#### Prey mass and hunt risk

Lions should be able to target:

* Wildebeest and zebra adults
* Buffalo, with major injury risk and preferably multiple hunters
* Elephant or rhino calves only under unusual circumstances

**Without persistent prides and cooperative hunting, lions would be one of the least convincing additions.**

---

## Leopard

### Model now

Leopards are the best-fitting carnivore:

* Solitary
* Individually territorial
* Stalk-and-ambush hunting
* Strong use of cover
* Wide diet
* Mother raises cubs without a social group
* Avoids stronger competitors

Current territory, home-range, stalking, parenting, memory, and individual hunting systems align well with this basic pattern. Leopards are predominantly solitary outside mating and mother-cub associations.

### Required additions

#### Ambush habitat

Current cover slows predator and prey equally. That does not model leopard hunting.

Cover should instead affect:

* Predator detection probability
* Maximum stalking distance
* Initial chase distance
* Capture odds
* Prey visibility

Leopard hunting success is associated with habitat-specific prey catchability and intermediate or dense cover.

#### Trees and kill caching

There are currently no individual trees, vertical position, climbing, or elevated carcasses. Therefore:

* Leopards cannot rest in trees.
* Leopards cannot escape lions or hyenas vertically.
* Leopards cannot cache kills above scavengers.
* Trees cannot serve as ambush points.

This is a major realism limitation.

A minimal vertical system could avoid full 3D simulation:

```text
entity elevation state:
ground
tree-canopy

tree entity:
position
capacity
climbable
```

Cached carcasses would remain spatially in the same cell but become inaccessible to non-climbers.

#### Prey-size eligibility

With only the eight listed species, most adult herbivores are too large to be normal leopard prey. The leopard needs:

* Calf targeting
* Juvenile targeting
* Weakened/injured adult targeting
* Or additional small and medium prey such as gazelles, impala, warthogs, monkeys, and smaller mammals

A species-level `preySpeciesIds` list is insufficient unless it also applies maximum prey-mass ratios.

#### Dominant-predator avoidance

Leopards should detect and avoid lions and hyenas, especially near kills. Fine-scale avoidance helps subordinate carnivores coexist with dominant competitors.

**A ground-only leopard could be convincing; a complete leopard cannot exist without trees or another vertical-refuge abstraction.**

---

# Recommended engine changes before adding all eight

## 1. Forage guilds

Replace the single conceptual food type with:

```text
grass biomass
grass height/quality
woody browse
optional point plants/trees
```

This separates zebra, wildebeest, buffalo, elephant, and black-rhino niches.

## 2. Persistent social groups

Add bounded group records:

```js
{
  id,
  type,
  speciesId,
  members,
  leaderId,
  territoryOwnerId,
  denOrCenter,
  createdTick
}
```

Support family bands, bachelor groups, elephant families, prides, coalitions, and clans.

## 3. Cooperative interaction framework

Generalize:

* Cooperative hunting
* Mobbing
* Group defense
* Recruitment
* Group-vs-group conflict

Do not implement separate lion, hyena, and buffalo combat systems.

## 4. Prey eligibility and profitability

Evaluate prey using:

```text
species compatibility
body-mass ratio
life stage
health
injury
group protection
terrain
expected energy return
expected injury risk
```

This is essential once predator and prey sizes vary widely.

## 5. Carcass ownership and kleptoparasitism

Add:

* Current possessor
* Possessing group
* Competitor approach
* Challenge
* Abandonment
* Fight
* Elevated/tree-cached accessibility

This enables realistic lion–hyena–leopard interaction.

## 6. Seasonal and diurnal behavior

Add configurable:

* Breeding windows
* Birth synchronization
* Activity periods
* Rest periods
* Seasonal movement strength

This is especially important for wildebeest and the three large carnivores.

## Practical implementation order

1. **Wildebeest** — strong fit with existing systems
2. **African buffalo** — add mob defense
3. **Black rhino** — add browse and sex-specific territory
4. **Zebra** — add persistent family bands and differentiated grass
5. **Leopard** — add prey-size rules, ambush effects, then trees
6. **Lion** — add prides and cooperative hunting
7. **Spotted hyena** — extend groups into clans, rank and kill competition
8. **Elephant** — add matriarchal leadership, woody vegetation and engineering

**Trying to add all eight as configuration files now would produce eight visually distinct animals, but lions, hyenas, elephants, and zebras would be behaviorally misleading.**

