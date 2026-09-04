# EverEcho v0.4 — production readiness

Evidence labels: **VERIFIED** (executed here) · **SOURCE-SUPPORTED** ·
**INFERENCE** · **ASSUMPTION** · **UNKNOWN**.

## The short answer

**Not ready for a bereaved family, and this release does not change that.**

Every blocker in `docs/PRODUCTION_READINESS.md`,
`REALTIME_PRODUCTION_READINESS.md` and `GROWTH_PRODUCTION_READINESS.md`
remains open. This document adds only what v0.4 introduces.

## What v0.4 adds to the blocker list

Filled in as slices land.

## The one that will not close by building

**Nobody bereaved has used this.** Every design decision in this release is a
claim about how a grieving person will experience something, and not one of
them has been tested with a grieving person. Specifically untested:

- Whether hearing the real voice comforts or wounds. It may do both, and it
  may depend on how recently they died in a way no product can detect.
- Whether the refusal in Slice 4 reads as care or as rejection at the moment
  somebody types *can I just talk to her*.
- Whether a sealed message arriving on a birthday is a gift or an ambush.
- Whether the pause offer in Slice 5 is a kindness or an interruption.

These need a bereavement counsellor and, eventually, consented research with
people who have lost someone. Automated tests can prove the product does what
it says. They cannot prove it should.

## Readiness verdict

**Build, and do not put it in front of a grieving person until somebody
qualified has looked at it.**
