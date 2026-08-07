Big Picture: The existing architecture should be extended rather than replaced. Its local-neighbor model, bounded alarm propagation and separation of aggregation from persistent identity are sound; the next step is to make persistent identity and group-level intent causally affect movement.

- Persistent group behavior is lacking: Members do not preferentially follow, seek or align with their persistent group
- Group-level decisions is lacking: No shared destination, movement commitment, leader, consensus or coordinated retreat.
- Shared centroid is too simple: All nearby conspecifics inside the social radius contribute to the same local centroid, e.g. two zebra bands that approach each other become behaviorally indistinguishable even though their persistent membership records remain separate. A zebra separated from its band does not deliberately return to it.
- Heterospecific attraction scaling is too simple: Association weight changes the centroid’s composition but not the strength of attraction, e.g. a lone gazelle among wildebeest follows them as strongly as it follows gazelles.
- 6-cell social radius is too small for some species: Too small for coordination of larger wildebeest/buffalo aggregations.

# Wildebeest - Should act more like a swarm / group-intelligence

What is lacking:

- No collective migration front or shared directional commitment. Every animal independently follows local environmental cues.
- No persistent short-term movement consensus after the original cue disappears.
- No large-herd internal structure, density waves or subherds that remain associated while spatially separated.
- No explicit wildebeest–zebra association (only gazelles declare heterospecific association)

# Zebra - Bands need to drive behavior

- The largest issue is that band membership does not affect zebra behavior. A band record says who belongs together, but zebras: do not seek bandmates; do not weight bandmates more strongly than unfamiliar zebras; do not follow a band-specific centroid; do not recognize a separated bandmate as a reunion target; do not maintain separation between adjacent bands.

# Buffalo - A defensive social core

What is lacking:

- No persistent cow–calf herd core or matrilineal relationships.
- No bachelor bull groups.
- No group leadership or experienced-female movement influence.
- No calf-centered spatial organization or defensive ring.
- No coordinated charge, pursuit or displacement of a predator after defense begins.

# Gazelle - A (relatively) generic herbivore

- This species should benefit from the general herding/social group changes that apply, e.g. heterospecific attraction scaling, persistent group behavior, etc.

Final note: Don't worry about how these updates affect the balance of the simulation. (We don't necessarily need to run 10x 15k tick sims to check ecological balance. But, if simulation runs are necessary to ensure the logic is bug-free, then do those runs.) This plan is concerned with implementing bug-free behavior. Balancing the behavior for ecological health will come in the future.
