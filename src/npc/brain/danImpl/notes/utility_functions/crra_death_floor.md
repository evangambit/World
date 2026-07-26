## Entry 2 — Batched consumption with a death floor → ~affine bulk + singularity (NOT clean `−1/w`)

**Setup.** Bake a batch, carry it across an `N`-second gap, eat `x`/sec to survive; running
out = death. Utility `f(books_read)` per library visit, `f' > 0`, `f'' < 0`. Undiscounted
long-run average. Proposed state utility `u(s,B) = −1/(s + kB)` (CRRA, γ=2).

**Flags.** additive · discounting absent · floor **terminal** · deterministic · single-batch
(the `−1/y` shape is read in the linear-`f` regime) · transit cost: resource.

**Marginal value.** *Claimed* `∝ 1/w²` (blows up at 0). *Honest* version: roughly **constant
in the bulk** with a **hard spike at the floor**.

**Mechanism — and where it's load-bearing vs decorative.**
- The **terminal floor genuinely demands a blow-up at 0** (panic / Inada). CARA lacks it.
  This leg is **solid**. *But the rate of blow-up (`1/w` vs `log w` vs …) is set by recovery
  dynamics; "some singularity" is what's justified, not specifically `1/w`.*
- The `−1/y` in per-second utility is **EOQ amortization of trip overhead**
  (`UPS = a − b/y`, `b = 2N` round-trip), **not inventory value.** It would appear unchanged
  for a neutral intermediate good with no death floor at all. Mapping its shape onto
  state-utility is a category error — flagged by the doc's own caveat.
- Under the assumed **linear `f`**, one extra unit of bread buys `1/x` seconds → `1/x` books →
  a **fixed** utility slug regardless of holdings. So true bulk marginal value is
  **constant**, contradicting the `1/x²` tail.
- The **option-value / polynomial-tail** argument **fails here**: deterministic, so a larder
  far from starvation genuinely *should* price near zero (you'll re-bake long before touching
  it). Option value needs uncertainty to bite (→ Entry 3).
- "UPS increasing in `y`" — the requirement that forces linear `f` — is equivalent to
  assuming **no interior optimal batch exists**. The hump from concave `f` (premise 6!) *is*
  the interior optimum, the analog of Entry 1's `Q*`; the growth-rate filter discards it.

**Derived vs imported.** Singularity-given-death: **derived**. Everything else
(`−1/y → −1/w` mapping, the specific γ=2, the polynomial tail, homotheticity-as-justification)
is **imported** by analogy or contradicts the linear-`f` premise.

**Distance.** Enters as a *resource cost* — transit cost = resource. You eat `x`/sec
*including while walking*, so distance burns the consumable itself. Accounting:
`UPS = (1−x) − 2Nx/y`; distance enters only via the amortized `2Nx/y`. The cycle length `y/x`
is **independent of `N`** — the `2N` seconds walking are exactly offset by `2N` fewer reading
seconds, because the bread fueling the walk is bread stolen from reading. Cost of distance =
`2N` books foregone per cycle, in utils, undiscounted. Because the consumable *is* the travel
fuel, distance sets proximity to the death floor: a long trip forces a large survival buffer
(`y ≥ 2Nx/(1−x)` just to survive transit) and a thin arrival margin near `B → 0` where the
`1/x` blow-up lives; a short trip keeps you in the flat, ≈linear bulk where the singularity is
irrelevant. **Distance selects which part of the utility function is operationally live — bulk
vs singularity.** This *sharpens* the entry's critique: the `1/w²` tail still does no work, but
distance is exactly what decides whether the floor — the one solid feature — governs behavior
at all.

**Transfers / breaks.** The floor-singularity intuition transfers to any genuine ruin
problem. The `−1/y` batch shape transfers nowhere (EOQ artifact). γ=2 transfers nowhere.

**Implementation (Dan).** `foodUtility()` uses `−1 / (satiety + inventory nutrition)` on the
hypo entity. Because satiety and inventory are perfect substitutes in that term, `ΔU(eat) = 0`
without a separate hunger signal. `hungerPenalty()` (quadratic above hunger 40) is the current
pragmatic stand-in for health/death in utility — see comments in `danBrain.js`.
