## Entry 4 — Scale-invariant exploration value → power-law / log (CRRA in distance)

**Setup.** Value a set of explored tiles; nearer-home tiles worth more. Require the NPC's
preference over the *shape* of the explored region to stay constant as the region scales.

**Flags.** separable-sum over tiles (Dynamics axis N/A — see schema note) · discounting
absent · floor none · deterministic · many rounds · transit cost: n/a.

**Implied utility.** `U(S) = Σ_{t∈S} v(dist(t, home))`, with `v` in the scale-invariant
family below. The draft representative `v(d) = min(1/d^α, 1)` is *one* member, not the
unique one.

**Marginal value.** `v'(d) ∝ −1/d^{α+1}` (power law) or `∝ −1/d` (log). Singularity at
`d=0` — but here `floor = none`, so this is a nuisance to cap, NOT a load-bearing floor
(contrast Entries 2–3, where the same blow-up is sacred). Read `u'`-at-0 together with the
Floor flag.

**Implementation (Dan).** `danBrain.explorationUtility()` uses `min(1/dist, 1)` per newly
seen tile (α = 1) relative to the memory centroid, scaled by `EXPLORE_WEIGHT = 0.0005`.
`exploreTask` scores frontier goals as weighted new tiles from the goal divided by path length.

**Mechanism (transferable).** Equal-count shape-invariance ⇒ per-tile value transforms
affinely under scaling: `v(kd) = A(k)v(d) + B(k)`. Complete solution set is TWO families:
- `v(d) = c·d^{−α} + e` (power law, offset allowed), and
- `v(d) = −β·ln d + e` (log in distance — the γ=1 boundary, cf. CRRA in wealth).
Both preserve same-count rankings (the `n·B(k)` aggregate term cancels across equal-count
sets). Exponential `e^{−λd}` is correctly excluded — it carries a hard scale `1/λ`.

**Derived vs imported.**
- The CRRA-in-distance *family* is **derived** from equal-count scale-invariance — but the
  family **includes log**, and excluding it is not free.
- **Pure** `1/d^α` (α>0, no constant, no log) requires the **stronger** axiom: invariance
  across sets of *different* tile counts (trading coverage against nearness). That kills
  `n·B(k)` ⇒ `B≡0` ⇒ drops the constant and log. **State which axiom you're using.**
- The exponent `α`: **free / taste**.
- The `min(·,1)` cap **reintroduces a fixed length scale**, breaking exact invariance near
  the origin — regularization in tension with the property it regularizes.
- Centroid-vs-literal-home reference point: soft joint (centroid makes `U` non-separable).

**Transfers / breaks.** Transfers to distance-weighted coverage with scale-invariant shape
preference (foraging range, sensor placement, map coverage). Breaks under time-discounting
on exploration (exponential bulk returns, cf. Entry 1) or a dynamic reference point
(non-separable; the marginal analysis no longer factorizes per tile).