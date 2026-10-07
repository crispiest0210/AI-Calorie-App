# Fixture eval set

**This is not the evaluation set the spec asks for.** Spec 2.7 calls for 100
personal meal photos with *weighed* portions; that set is private by nature and
is the owner's to collect. This directory holds a handful of hand-written
meals whose recorded "responses" were written by hand, not produced by a model.

What it is for: proving the harness itself works — that the metrics compute,
that a schema violation is caught, that a nutrient field in the output fails
the run, and that the matcher is exercised against the real catalog. It runs in
CI for free and gates changes to the matcher and the scoring code.

It says nothing about how good any model is. The first number that means
anything comes from running `--live` against real photos.

## Collecting the real set

1. Photograph meals as you normally would, and weigh each component before
   eating it. An eyeballed weight measures the labeller, not the model.
2. For each photo add an entry to `set.json` with the catalog `foodId` you
   would have picked and the weighed `grams`.
3. Record model responses once (`record-eval`), then replay them forever.

`catalogVersion` exists because a food id only means something against one
catalog build. Rebuild the catalog and the ids move; re-point the set.
