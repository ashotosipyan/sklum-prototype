# Deliverable 1 — Business case

## The case in one paragraph

Sklum's web store converts strangers. It cannot hold a relationship. Every order that arrives
through guest checkout leaves Sklum with a transaction and no customer, and every "where is my
order?" email is a trust event handled by a support agent instead of by the product. The app's
Year 1 job is not to add a sales channel — it is to convert transactional buyers into identified
customers at the one moment they are motivated to identify themselves, and to make delivery
legible. That produces two compounding assets: a known-customer base and a clean first-party
signal stream. Year 2 and Year 3 monetise those assets. Year 1 builds them, and roughly pays for
itself while doing so.

I would rather defend that than a Year 1 revenue story I don't believe.

## Who it is for

Three segments, in Year 1 priority order.

**The post-purchase tracker.** Has an order in flight, a lead time measured in weeks, and no
reliable way to find out where it is. Currently emails support or refreshes a carrier page. Highest
volume, highest anxiety, and — critically — the one customer with a concrete reason to create an
account. This is the identification engine.

**The project planner.** Mid-renovation or furnishing a new space. Buys across multiple sessions
over weeks, currently managing it in open browser tabs and screenshots. Highest basket value, and
the natural user of HomeByMe 2.0 and budget planning. Year 2 priority.

**The repeat decorator.** Buys smaller items seasonally, browses inspiration between purchases.
Highest interaction frequency, lowest per-order value, and the segment that makes a feed worth
building. Year 2 into Year 3.

## What the web cannot deliver

Not "the app is nicer" — five things the web structurally cannot do:

1. **Persistent identity without a login wall.** An installed app is authenticated once and stays
   authenticated. A browser is a stranger every session unless you degrade the funnel.
2. **An owned re-engagement channel.** Push at a delivery milestone is a welcome message. Email at
   the same milestone is a 25% open rate.
3. **On-device room capture.** ARKit/ARCore room scanning has no browser equivalent at usable
   quality, and this is the entire basis of HomeByMe 2.0.
4. **Continuity across sessions and offline.** A saved project that survives a closed tab, a lost
   connection and a device change.
5. **Behavioural signal tied to one identity over time.** Web signal is fragmented across
   anonymous sessions. This is the input to everything in Year 2 and 3.

## Assumptions

All directional, all stated so they can be argued with.

| Assumption | Value | Basis |
|---|---|---|
| Annual GMV | €400M | "Mid-hundreds of € millions", midpoint |
| Average order value | €110 | Mid-market furniture and décor mix |
| Annual orders | ~3.6M | GMV ÷ AOV |
| Support contacts per order | 0.22 | Long lead times raise WISMO above retail norms |
| Blended cost per contact | €4.50 | Mixed chat, email, phone, Southern Europe |
| Current identified-customer share | 35% of orders | Guest checkout dominant on pure-play D2C |
| Current repeat purchase rate | 28% annual | Furniture category norm |
| App-attached share of orders, end Y1 | 12% | Driven by post-purchase install prompt, not marketing |
| Year 1 team cost | ~€1.05M | 5 engineers, 1 designer, 1 PM, plus infrastructure |

## The four value levers

### 1. WISMO deflection

3.6M orders × 0.22 contacts = ~790k support contacts per year, ~€3.6M in cost. Order tracking in
the app deflects an estimated 35% of WISMO for app-attached orders.

`3.6M × 12% × 0.22 × 35% × €4.50 ≈ €150k` in Year 1.

Small. I include it because it is the most defensible number here and because the cost saving is
not the point — the deflected contact is a customer who got an answer in three seconds instead of
a day. The trust effect is real and shows up in lever 3.

### 2. Repeat purchase rate

Assume ~250k app-attached customers by end of Year 1 and a +4pp lift in repeat purchase rate on
that cohort, driven by feed re-engagement and reduced friction on a second order.

`250k × 4pp × €110 ≈ €1.1M` incremental GMV.

This is the lever that compounds. At 800k app customers and +7pp in Year 2 it is ~€6.2M.

### 3. Known-customer share

The mechanism is specific: a customer who wants to track an order will authenticate to do it. That
converts identification from a marketing ask into a utility exchange. Target is 35% → 45% of
customers identified by end of Year 1, roughly 400k newly identified customers.

Valuing an identified customer at €5/year in incremental owned-channel revenue versus anonymous:

`400k × €5 ≈ €2.0M`

This is the softest number in the document and I would say so in the room. It is also the most
strategically important, because it is the input to Year 2 and 3.

### 4. Conversion confidence from delivery transparency

A visible, honest delivery commitment at the decision point. Assume +1.5% conversion on app
sessions against €48M of app GMV: `≈ €0.7M`. HomeByMe budget planning adds basket value from
Year 2, not Year 1.

### Year 1 total

**~€4.0M of incremental value against ~€1.05M of cost**, on a €400M base. That is 1% of GMV.

The honest framing: Year 1 clears its own cost and not much more. The return is the 400k identified
customers and the event stream, both of which are prerequisites for Year 2 personalisation and
Year 3 conversational commerce. If the board wants a Year 1 revenue story, the app is the wrong
investment. If they want the asset that makes Years 2 and 3 possible, this is what building it
costs.

## Three-year shape

| | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| App share of orders | 12% | 25% | 40% |
| App-attached customers | 250k | 800k | 1.6M |
| Identified customer share | 45% | 60% | 72% |
| Incremental value | ~€4M | ~€14M | ~€32M |
| Dominant lever | Identification | Repeat rate | Frequency and basket |

## Sensitivity

Year 1 incremental value under varying adoption and repeat lift:

| | +2pp repeat | +4pp repeat | +7pp repeat |
|---|---|---|---|
| 8% app share | €2.6M | €3.0M | €3.6M |
| 12% app share | €3.5M | €4.0M | €4.7M |
| 20% app share | €5.2M | €6.0M | €7.2M |

The case survives the pessimistic corner. It does not become exciting until adoption clears ~20%,
which is a Year 2 outcome, not a Year 1 one.

## How we would know it is working

**North stars, with Year 1 targets:**

| Metric | Baseline | Y1 target |
|---|---|---|
| WISMO contacts per app-attached order | 0.22 | 0.16 |
| Identified share of customers | 35% | 45% |
| Repeat app opens (4+ per month, installed base) | — | 40% |
| Delivery promise met within stated window | unmeasured | ≥92%, measured |
| Repeat purchase rate, app cohort | 28% | 32% |

Note that "delivery promise met" is currently unmeasured. Establishing the measurement is itself a
Year 1 deliverable, and arguably the highest-value one — you cannot improve delivery predictability
that you have never quantified.

**Explicitly not a metric:** downloads. An install that never opens again is a cost.

**Guardrails:** p95 feed latency under 400ms, crash-free sessions above 99.5%, and app-attached
orders measured as *incremental* rather than assumed.

## Measurement design

The trap in this case is selection bias. Customers who install an app are already more engaged, so
the app cohort will outperform the web cohort no matter what you build. Attributing that gap to the
app would overstate the result by a wide margin and the number would collapse under scrutiny.

Two mitigations:

1. **A holdout.** Withhold the post-purchase install prompt from a random 5% of eligible orders and
   compare repeat rate at 6 and 12 months. This is the only clean read on incrementality available.
2. **Pre-post within customer.** For customers who install, compare their own behaviour before and
   after, which controls for the individual rather than the cohort.

Both are cheap to implement and should be designed in before launch, not retrofitted when someone
asks whether the number is real.

## What would change my mind

- If measured WISMO contacts per order come in below 0.10, lever 1 mostly disappears and the case
  rests on identification alone — still viable, but thinner.
- If post-purchase install conversion runs below 8%, the identification engine does not work and
  the whole Year 1 mechanism needs rethinking before scaling investment.
- If the commerce core APIs turn out to require substantial change, the cost side moves materially
  and Year 1 stops clearing its own cost.
