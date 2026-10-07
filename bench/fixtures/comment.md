<!-- sia-storage-bench -->
### Streaming benchmark

Each of 5 rounds played one random video from the share on both builds, then played it again after a reload. Production indexer and hosts, Chrome 154, up to 30 s or 60 MB per play. Medians of the rounds. Green is better and red is worse, only for a change over 0.5 s and 10% that no round contradicts.

Base `feat/shared-stream-handoff` · This PR `feat/stream-warm-up` · only this PR warmed host connections before Play

```diff
                                  base   this PR    change
  Moving after Play              8.7 s     4.3 s    −4.4 s
  Moving after a reload         18.0 s     4.3 s   −13.7 s
  Never moved, after reload     0 of 5    0 of 5
  Refused hosts, after reload        0         0
```

<details open><summary><b>Every step that changed</b></summary>

```diff
  BEFORE PLAY
                0s        1s        2s        3s
  Connect to the indexer
    base        ███████████████████ 1.9 s
    this PR     █████ 0.5 s                                       −1.4 s
  Find the file
    base        █████████████████████████████ 2.9 s
    this PR     ███ 0.3 s                                         −2.6 s
  Warm up hosts
    base        not warmed
    this PR     ███████████████████ 1.9 s

  AFTER PRESSING PLAY
                0s             5s             10s
  Worker loads the host list
    base        ▉ 0.3 s
    this PR     before Play                                       −0.3 s
  First host connected
    base        █▊ 0.6 s
+   this PR     at once                                           −0.6 s
  First byte
    base        ██████ 2.0 s
    this PR     ████▎ 1.4 s                                       −0.6 s
  Video moving
    base        ██████████████████████████▏ 8.7 s
    this PR     ████████████▉ 4.3 s                               −4.4 s

  AFTER A RELOAD
                0s        10s       20s
  First byte
    base        ██▎ 2.2 s
    this PR     █▎ 1.3 s                                          −0.9 s
  Video moving
    base        ██████████████████ 18.0 s
    this PR     ████▎ 4.3 s                                      −13.7 s

  PLAYBACK, FIRST PLAY
  Delivered to the video
    base        █████████████████████████████████ 1.1 MB/s
    this PR     ████████████████████████████████████ 1.2 MB/s
  Connections dropped while opening
    base        ██████████████▍ 48
    this PR     ███████████████████████████████████▏ 117
  Price requests per host
    base        ██████████████████████████████████▎ 11.4
+   this PR     ████████████████████▏ 6.7
  Froze
    base        ██████████████████████████████ 1 of 5
    this PR     ▏ 0 of 5
```
Same on both builds, so not shown: 1.3 MB read from the indexer, the stream URL made at once, no file lookup needed, no refused connections after a reload, no refused connections on the first play.
</details>

<details><summary><b>Waterfall: what waited on what</b></summary>

Time from opening the link. The viewer's wait before pressing Play is cut out.

```
  FIRST PLAY
                    0s        5s        10s       15s
  base
    load the SDK    ▏ 0.0 s
    connect         ███▊ 1.9 s
    find the file       █████▊ 2.9 s
    make stream URL        ▏ 0.0 s
    Play                      ▼
    host list                 ▋ 0.3 s
    first host                 ▍ 0.2 s
    first byte                    ▏ 2.0 s after Play
    video moving                               ▏ 8.7 s after Play
  this PR
    load the SDK    ▏ 0.0 s
    connect         █ 0.5 s
    find the file    ▋ 0.3 s
    make stream URL   ▏ 0.0 s
    warm up hosts     ███▊ 1.9 s
    host list         ▋ 0.3 s
    first host         ▍ 0.2 s
    Play                  ▼
    first byte               ▏ 1.4 s after Play
    video moving                  ▏ 4.3 s after Play

  AFTER A RELOAD
                    0s        5s        10s       15s       20s
  base
    load the SDK    ▏ 0.0 s
    connect         █ 0.5 s
    find the file    ▍ 0.2 s
    make stream URL  ▏ 0.0 s
    Play             ▼
    host list        ▋ 0.3 s
    first host        ▋ 0.3 s
    first byte            ▏ 2.2 s after Play
    video moving                                         ▏ 18.0 s after Play
  this PR
    load the SDK    ▏ 0.0 s
    connect         █ 0.5 s
    find the file    ▊ 0.4 s
    make stream URL   ▏ 0.0 s
    warm up hosts     ██████▍ 3.2 s
    host list         █▊ 0.9 s
    first host         █ 0.5 s
    Play                    ▼
    first byte                 ▏ 1.3 s after Play
    video moving                     ▏ 4.3 s after Play
```
</details>

<details><summary><b>Each round</b></summary>

| | Video | Moving, base / PR | After a reload |
| ---: | --- | ---: | ---: |
| 1 | `46704cf8` expedition-69-axiom-mission-2-space-station-arrival-we | never / 4.1 s | 23.0 / 5.4 s |
| 2 | `3cee0abb` crew-10-astronauts-undock-from-international-space-sta | 8.7 / 4.3 s | 18.9 / 27.5 s |
| 3 | `4f881134` iss063m261321544-expedition-63-cygnus-crs-13-release-2 | 7.4 / 17.8 s | 5.3 / 4.3 s |
| 4 | `3d33aa52` s-boeing-crew-flight-test-launch-scrub-720p | 7.2 / 3.8 s | 7.0 / 4.1 s |
| 5 | `0ef161e9` spacex-crew-8-launch-4k | 24.6 / 4.4 s | 18.0 / 3.8 s |
</details>

<sub>Run 37990737474 on df3c358 · numbers for every play are in its artifact</sub>
