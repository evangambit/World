## Entry 3 — Multiplicative reinvestment under uncertainty → log (Kelly)

**Setup.** Repeated favorable gambles with known odds; reinvest the *entire* bankroll each
round; maximize long-run growth. Wealth `Wₜ₊₁ = Wₜ · Rₜ(bet)`. Stochastic, many rounds.

**Flags.** **multiplicative** · discounting absent (long-run growth-rate criterion) · floor
**terminal** (ruin is absorbing) · **stochastic** (first entry where uncertainty is
load-bearing) · many rounds (the asymptotics *are* the objective) · transit cost: n/a.

**Implied utility.** `u(W) = log W`. **Marginal value `u'(W) = 1/W`** (CRRA, γ=1). Blow-up at
0 — never bet the whole bankroll; no-ruin is enforced by the singularity, not bolted on.

**Mechanism (transferable).** Multiplicative compounding ⇒ the long-run growth rate is the
**time-average of log-returns** (LLN / ergodic): `(1/T)·log(W_T/W₀) → E[log R]`. Maximizing
growth = maximizing `E[log R]`. **Log is the dynamics' own bookkeeping, not a taste for
diminishing marginal utility.** Every headline property is a *theorem* off this one fact:
- maximizes long-run expected log wealth (definitional),
- asymptotically maximizes **median** wealth,
- maximizes the **geometric** growth rate,
- minimizes **expected time** to a large wealth goal (Breiman),
- **almost surely** outperforms any essentially different strategy in the long run (Breiman).

**Derived vs imported.** Log **and** γ=1 are **derived** — this is the clean contrast with
Entry 2's imported γ=2. No-ruin singularity: derived (multiplicative makes 0 absorbing).
**Soft joint:** pure Kelly is the *long-horizon, full-reinvestment, known-probability*
optimum. Finite horizon, drawdown aversion, and estimation error all push toward **fractional
Kelly** — that shading is a robustness/taste adjustment, *not* derived. Also assumes pure
reinvestment (no consumption); add consumption and the form changes.

**Transfers / breaks.** Transfers to any multiplicative-reinvestment-under-uncertainty
process — portfolio growth, bet sizing, biological fitness (log = geometric mean of
offspring). **Breaks the instant dynamics are additive** (which is exactly why log appears in
neither bread problem), if you consume rather than reinvest, or on short horizons.
