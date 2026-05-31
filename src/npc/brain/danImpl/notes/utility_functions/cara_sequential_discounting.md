## Entry 1 — Sequential production under discounting → CARA

**Setup.** Maximize discounted output of a produce-then-deliver cycle: harvest wheat at rate
`h`, walk, bake it into bread at rate `b`, discount each loaf at rate `r`. Deterministic.

**Flags.** additive · discounting present · floor none · deterministic · cyclic (bulk is
single-batch-local).

**Implied utility** (value of wheat in the kitchen, about to be baked):
`V_K(w) = b/r − C·e^(−(r/b)w)`, with `C = b/r − e^(−rτ)·V₀ > 0`. CARA, rate `a = r/b`.

**Marginal value.** `V_K'(w) = (r/b)·C·e^(−(r/b)w)`. **Finite at zero** (`V_K'(0) ≈ 1` loaf
per unit — slightly under 1 from the discount until baking). Exponential decay, natural scale
`1/a = b/r`.

**Mechanism (transferable).** Exponential discounting × sequential consumption: each later
unit of wheat is baked `1/b` later, so its reward is discounted by an extra `e^(−r/b)` →
geometric decay in marginal value → exponential bulk. **CARA here is a discounting artifact,
not a risk preference.** In a deterministic problem there is no risk for curvature to encode.

**Derived vs imported.** Fully derived — the exponential *and* the rate `a = r/b` fall out of
the algebra. Nothing imported.

**Transfers / breaks.** Transfers to any sequential-delivery-under-discounting problem.
Breaks if you add a terminal floor (CARA has no singularity at 0 — wrong) or remove
discounting (the exponential vanishes; see Entry 2's bulk).
