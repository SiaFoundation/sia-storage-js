# Streaming benchmark

Plays shared videos in Google Chrome through the built SDK and its prebuilt service worker, against the real indexer and real hosts, and reports how long each step took. It exists so a change to the SDK, or to the Rust core it is built from, can be checked for its effect on streaming before it ships. Nothing here is published in the npm package.

## Run it

Build the SDK first, since the benchmark serves `dist/` and `wasm/` as they are:

```bash
bun run build
BENCH_SHARE_SEED=<seed> bun run bench --budget-mb 60
```

The seed is a sharing key's seed. Without `BENCH_FILE_ID`, the benchmark lists the key's share and plays a different video, picked at random, in each round. Set `BENCH_FILE_ID` to an object ID to play that one file every round instead. `BENCH_INDEXER_URL` overrides the indexer, `https://sia.storage`.

Use a key kept for benchmarking: every byte read is billed to its owner. A play reads what the video asks for in the window, which for a 4K video can be a few hundred megabytes, so set `--budget-mb` to cap it. The seed is passed to the page in its address fragment, which a browser never sends to a server.

It needs Google Chrome itself. Playwright's bundled Chromium cannot decode H.264.

| Option | Default | Meaning |
| --- | --- | --- |
| `--rounds` | 3 | Rounds to play. The report is the median of them. |
| `--window` | 45 | Seconds recorded after each press of Play. |
| `--budget-mb` | none | Stop recording a play once this many megabytes have reached the video, if that comes before the window ends. Short and long videos then cost the same. |
| `--warm` | off | Open connections to the file's first hosts before Play with the SDK's `warm()`. A build without `warm()` is not warmed, so a comparison against a build that adds it shows the difference. |
| `--sdk` | this repo | A directory holding the `dist/` and `wasm/` of the build to measure. |
| `--base` | none | A second build's directory, to compare the first against. See below. |
| `--out` | `bench/results/run.json` | Path of the results file. |
| `--headed` | off | Show the browser window. |

## What a round does

For each build:

1. Starts Chrome on a brand new profile.
2. Opens the page, which connects to the indexer, looks the file up and makes its stream URL.
3. Waits 5 seconds, presses Play and records for the window, or until the budget has reached the video.
4. Reloads the page and does steps 2 and 3 again.

The reload is the point of step 4. Chrome penalizes failed WebTransport connections, and for connections made from a service worker it keeps those penalties for the whole browser profile. A fault that fills them shows as a normal first play and a second play with no picture, so a benchmark of one play cannot see it.

## Comparing two builds

```bash
bun run bench --base ../main-build --budget-mb 60 --out results.json
bun run bench/report.ts --results results.json --out comment.md
```

With `--base`, each round plays its video on both builds back to back, alternating which goes first, so both meet the same hosts within a few minutes. A round where either build fails is left out for both. The results file holds every play of every round, and `report.ts` turns it into the Markdown comment the workflow posts:

- a headline of when the video started moving after Play and after a reload, how many reloads never moved, and how many host connections Chrome refused after a reload,
- every step whose two builds differ, base over head as a pair of bars, with the steps both builds share named in one sentence,
- a waterfall of the first play and of the play after a reload, with the viewer's wait before Play cut out,
- a table of each round's video with both builds' moving times, and the rounds that failed.

Every number is the median over the rounds, and a change is the head's median minus the base's. Real hosts make every timing noisy, so a change is coloured, green for better and red for worse, only when both of these hold:

- The medians differ by enough: a time by more than 0.5 s and more than 10% of the base, a count or a rate by more than 25% of the base and by at least 1.
- The rounds show it too: all but at most one of them, and at least two, changed by that much the way the medians did, and none moved the other way by any amount. A round in which both builds got the same number counts for neither side.

One slow answer from the indexer can add 10 seconds to a play and lands on either build by chance, which is why a difference in the medians alone is not enough. One round the other way withholds the colour because five rounds cannot tell a fluke from a tie: with two builds that perform the same, four or more of five rounds favour the same one 3 times in 8. A count of plays, such as how many froze, has one number for the whole run, so it is coloured when the builds differ by at least half the rounds and by at least two plays.

`fixtures/results.json` holds a CI run's results, and `report.test.ts` checks that they render as `fixtures/comment.md`.

## On pull requests

`.github/workflows/benchmark.yml` runs the comparison in CI on `ubuntu-latest`, which has Google Chrome installed. It builds the browser bundles of both sides, runs 5 rounds with a 30 second window, a 60 MB budget and `--warm`, and uploads the results file as an artifact.

- **Label.** Adding the `benchmark` label to a pull request compares its base branch with it and removes the label, so adding it again runs it again. A pull request has one benchmark comment. It says a run is in progress as soon as one starts, and that run's report replaces it.
- **By hand.** Running the workflow from the Actions tab or with `gh workflow run benchmark.yml` takes two optional inputs. `pr` is a pull request number to benchmark and comment on. Without it, the branch the workflow runs on is compared with the default branch and the report goes to the run's summary. `sia_sdk_rs_ref` is a sia-sdk-rs branch, tag or full commit SHA to build the head side from, in place of the version in `.sia-sdk-rs.json`, so a Rust change can be measured before it is released. A workflow can only be run by hand once it is on the default branch.

It needs the repository secret `BENCH_SHARE_SEED`, and `BENCH_FILE_ID` to play one file instead of a random video from the share. The benchmark runs the pull request's own code with that seed, so the workflow refuses a pull request from a fork, by label or by hand.

A run reads up to about 60 MB per play and 4 plays per round, so about 1.2 GB of video for 5 rounds, plus the share's listing, all billed to the key's owner.

## What it reports

Times are seconds. Steps before Play are how long the step took. First host connected, first byte, picture and video moving are measured from the press of Play.

| Number | Meaning |
| --- | --- |
| Read from the indexer | Megabytes the page read from the indexer before Play, decompressed. |
| Worker loads the host list | How long the service worker spent loading the host list after Play, from its first request to its last byte. 0 when a warm-up loaded it before Play. |
| Worker looks the file up | How long the worker spent looking the file up at the indexer after Play. 0 when it did not need to. |
| First host connected | When the worker's first host connection finished its handshake. 0 when a warm-up had connected one before Play. |
| Picture | When the video element could show its first picture. |
| Delivered to the video | Megabytes handed to the video element per second recorded. |
| Connections dropped while opening | Host connections the SDK closed before their handshake finished. Chrome counts each as a failure. |
| Connections Chrome refused | Host connections Chrome refused outright because of those failures. |
| Price requests per host | Price requests sent, divided by the hosts asked. One is enough. |
| Froze | Plays that never moved, or stopped for data for more than a second after they started moving. |

Indexer calls are timed to their last byte, not just their headers, since a listing that carries every file's storage layout spends most of its time on the body.

## How it measures

`page/hooks.js` wraps `fetch`, `WebTransport` and the worker's fetch event before the SDK loads, in the page and in the service worker, so the SDK and its prebuilt worker run unchanged. `page/main.js` is the smallest app that plays a shared file: it connects, looks the file up, asks for a stream URL and hands it to a `<video>`. It uses SDK features such as `objectSummaries` and `warm()` when the build has them, so the same page measures older and newer builds. It does not imitate a feature a build lacks. `summary.ts` turns one play's events into a timeline of its steps, and `report.ts` turns the results file into the pull request comment.
