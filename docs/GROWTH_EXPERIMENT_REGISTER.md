# EverEcho v0.3 — experiment register

**Nothing in this register has run.** There are no customers, no paid
deposits, no families and no traction. Every threshold below is a
**FOUNDER HYPOTHESIS**, written down so that it can be falsified later, and
none of it is evidence of anything today.

Fabricating a result here would be worse than having none.

## Status legend

`NOT STARTED` · `RUNNING` · `CONCLUDED — continue / revise / stop`

## The register

| # | Hypothesis | Segment | Test | Owner | Metric | Threshold | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E-01 | Families will pay a deposit before the archive exists | 50 qualified families | Reservation flow with private storyteller acceptance | Founder | Paid deposits | ≥ 10 | NOT STARTED |
| E-02 | A storyteller who accepts will approve five memories quickly | Paid families | Time from acceptance to fifth approval | Founder | % within 14 days | ≥ 60% | NOT STARTED |
| E-03 | Storytellers will invite family unprompted | Paid families | Invitation rate in first 30 days | Founder | % inviting ≥ 1 | ≥ 70% | NOT STARTED |
| E-04 | The family loop closes | Accepted family members | Question asked or contribution made | Founder | % within 30 days | ≥ 30% | NOT STARTED |
| E-05 | Questions produce approved memories | Storytellers with ≥ 1 question | Answer → candidate → approval | Founder | % of questions yielding an approved memory | ≥ 40% | NOT STARTED |
| E-06 | Citations are inspected, not ignored | Family members receiving cited answers | Citation-open rate | Founder | % opening ≥ 1 source | ≥ 25% | NOT STARTED |
| E-07 | Capsules drive recipient activation | Capsule recipients | First access → account creation | Founder | Conversion | ≥ 35% | NOT STARTED |
| E-08 | Hinglish materially widens the market in India | Indian families | Language chosen at capture | Founder | % choosing Hindi or Hinglish | ≥ 30% | NOT STARTED |
| E-09 | Gap radar increases approved memories without feeling like pressure | Active archives | Approvals per week, plus dismiss rate | Founder | Approvals up, dismiss < 40% | Both | NOT STARTED |
| E-10 | A founder or institution will pay for the same infrastructure | B2B prospects | Design-partner conversations | Founder | Signed paid design partners | ≥ 3 before any P2 build | NOT STARTED |

## Gates that block engineering expansion

From the brief, recorded here so they are checkable rather than remembered:

- No broad engineering expansion before **10 paid deposits from 50 qualified
  families** (E-01).
- No team expansion before **25 paid family pilots**.
- **No P2 product build** — Founder Vault, Institutional Workspace, public
  API/SDK — without **three paid design partners or equivalent strong
  evidence** (E-10).
- **Zero critical trust incidents**, at all times. This one is not a threshold
  to hit; it is a condition to maintain.

## The north-star metric

**Activated Family Archive**: an archive with ≥ 20 approved memories, ≥ 2
accepted authorised family members, ≥ 1 cited family question or approved
contribution, current consent with export and deletion readiness, and
meaningful activity in the previous 90 days.

Implemented as a query over content-free funnel events and domain state.
**Current value: 0**, because there are no real archives. The demonstration
archive is synthetic and is deliberately excluded from any metric that could be
mistaken for traction.
