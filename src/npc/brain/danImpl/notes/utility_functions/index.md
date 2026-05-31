# Implied-Utility Library

A catalog of problems and the utility functions their structure *implies*. The organizing
claim, learned the hard way: **the utility form is a shadow of the dynamics.** You don't
choose CARA or CRRA or log by taste — you read off which one the problem's structure forces,
and most of the disagreement that feels like "two compelling arguments" is actually two
different problems wearing the same notation.

## How to read this

- **Index by generative structure, not functional form.** Two problems with the same `u`
  can have unrelated mechanisms; the same mechanism throws different `u` under different
  flags. Filing by form makes CARA and CRRA look like rivals; filing by structure shows
  they answer different questions.
- **Log `u'(x)`, the marginal value — not `u`.** The behavior lives in the marginal: the
  `∞`-at-zero, the polynomial vs exponential tail, the constant-slug-per-unit. Forms that
  look different as `u` are often identical as `u'`, and vice versa.
- **Separate *derived* from *imported*.** Mark which features fall out of the dynamics
  (rigorous) and which are taste or analogy (soft joints). The library is most useful when
  it flags its own soft joints instead of laundering taste into apparent necessity.
- **The catalog's job is NOT lookup.** It's to read the flags fast, recognize when you're
  in an uncatalogued *combination* (most real problems are), and know you then have to
  actually solve it. A catalog that makes you more willing to grab the nearest named form
  is worse than none.

## Structural flags (the index)

1. **Dynamics** — *additive* (state changes by adding/subtracting a flow) vs *multiplicative*
   (state multiplies by a return factor). Multiplicative + uncertainty + reinvestment is the
   only thing that generates `log`.
2. **Discounting** — exponential time-discount *present*, or a long-run-average / horizon
   criterion (*absent*). Discounting alone manufactures exponential bulk with zero preference
   content.
3. **Floor** — what hitting zero costs: *none* (recoverable, bounded inconvenience) vs
   *terminal* (absorbing — ruin, death). A terminal floor demands a marginal-value blow-up at
   `0` (Inada). This is the entire CARA-vs-CRRA boundary axis.
4. **Uncertainty** — *deterministic* vs *stochastic*. Only stochastic turns curvature into a
   *risk* statement and gives option value something to hedge. Under determinism a
   far-from-floor stockpile genuinely *should* price near zero.
5. **Horizon** — *single batch* (curvature sampled too locally to register → effectively
   affine) vs *many rounds / long horizon* (satiation or compounding reasserts). Predicts
   when a linear-in-the-bulk default breaks.
6. **Transit cost** — when a cycle carries a fixed per-trip overhead (travel, setup), is it
   paid in *time* or in the *resource*? *Time*: dead wall-clock that lengthens the cycle and
   is discounted — it rescales the value *amplitude* and shifts optimal batch size but leaves
   curvature untouched, and only bites when discounting > 0. *Resource*: the consumable is
   burned during transit — it does not lengthen the cycle, costs foregone utility directly,
   and drives the operating point toward or away from the floor singularity. Routes the *same*
   distance primitive to "amplitude" in one problem and "how often you touch the floor" in
   another.

## Lookup

| # | Problem | Dynamics | Discount | Floor | Uncertainty | Horizon | Implied `u'(x)` | Transit cost |
|---|---------|----------|----------|-------|-------------|---------|-----------------|--------------|
| 1 | Bread w/ discounting | additive | **yes** | none | det. | cyclic | `∝ e^(−(r/b)x)`, finite at 0 | time |
| 2 | Bread w/ death | additive | no | **terminal** | det. | single-batch | claimed `∝ 1/x²`; truer: ~flat bulk + spike at 0 | resource |
| 3 | Kelly betting | **multiplicative** | no | **terminal** (ruin) | **stochastic** | many rounds | `∝ 1/x` | — |
| 4 | Exploration (tile coverage) | additive (sum) | no | none | det. | many rounds | `∝ 1/d^(α+1)` per tile, power-law in distance | — |

> **Cross-entry note.** Entries 2 and 3 are *both* "CRRA with a terminal floor," but γ=2 vs
> γ=1 — and that contrast is the whole argument for indexing by structure. The curvature γ is
> *set by the dynamics*, not chosen: multiplicative compounding forces γ=1 (derived, solid);
> Entry 2's γ=2 is imported by analogy (soft). Same family, same floor, different reason,
> different confidence.
>
> **Entry 4** is CRRA-*in-distance* per tile rather than CRRA-in-wealth, forced by the same
> scale-invariance argument — but the aggregate utility is a sum over items, not a function
> of a single scalar state.
>
> **Distance, Entries 1 vs 2.** Same primitive — a round-trip overhead (`2τ` / `2N`), the EOQ
> fixed cost that makes batching worthwhile, so in both, more distance → bigger batches. The
> flags route it oppositely: Entry 1 (discounting, no floor) pays in discounted *time* →
> rescales amplitude, curvature untouched; Entry 2 (terminal floor, no discounting,
> consume-in-transit) pays in the *consumable* → drives the operating point into or out of the
> starvation singularity. The latent axis: do you consume during transit?

---

## Entries

- [Entry 1 — Sequential production under discounting → CARA](cara_sequential_discounting.md)
- [Entry 2 — Batched consumption with a death floor → ~affine bulk + singularity](crra_death_floor.md)
- [Entry 3 — Multiplicative reinvestment under uncertainty → log (Kelly)](log_kelly.md)
- [Entry 4 — Scale-invariant exploration value → power law (CRRA in distance)](power_law_exploration.md)

---

[Template for new entries](template.md)