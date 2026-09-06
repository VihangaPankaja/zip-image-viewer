# Video latency baseline

- Generated: 2026-09-06T07:12:03.712Z
- Machine: VihangaPC / win32 10.0.26200 / Intel(R) Core(TM) i7-8565U CPU @ 1.80GHz
- Network: loopback, unthrottled
- Clip: 24 s, 640x360 H.264/AAC deterministic fixture

| Mode         | Samples | Startup p50 (ms) | Startup p95 (ms) | Seek p50 (ms) | Seek p95 (ms) | Buffer p50 (s) | Transfer p95 (ms) | Encoder queue p95 (ms) | Encoder p95 (ms) | Rendition | Cache |
| ------------ | ------: | ---------------: | ---------------: | ------------: | ------------: | -------------: | ----------------: | ---------------------: | ---------------: | --------- | ----- |
| Original     |       5 |             78.4 |            829.1 |         100.7 |         117.6 |            4.8 |              27.1 |                      0 |                0 | source    | n/a   |
| Prepared HLS |       5 |            198.2 |            229.9 |         132.9 |        5048.6 |            4.8 |              76.1 |                      0 |                0 | 360p      | hit   |
| Cold HLS     |       5 |           1311.9 |             1327 |        5083.1 |        5133.1 |            0.8 |             179.8 |                      0 |             5264 | 360p      | miss  |
