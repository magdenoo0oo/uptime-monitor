# Egyptian websites — live uptime

Checked 20–30 times a day by [`collect.yml`](../.github/workflows/collect.yml) using this project's own probe
(exponential-backoff retries before a site counts as down). **Up** = the server answered with a status below 500
within 15 s. Probes run from GitHub Actions runners (outside Egypt), so sites that block foreign traffic aren't listed.

_Last check: 2026-11-17T20:04:56Z_

|  | Site | Category | Today | 7 days | 30 days | p95 (7d) |
|---|---|---|---|---|---|---|
| 🟢 | Central Bank of Egypt | Banks | 100% | 100% | 100% | 744 ms |
| 🟢 | National Bank of Egypt | Banks | 100% | 100% | 100% | 1758 ms |
| 🟢 | Banque Misr | Banks | 100% | 100% | 100% | 2628 ms |
| 🟢 | CIB | Banks | 100% | 100% | 100% | 3188 ms |
| 🟢 | Fawry | Payments | 95.24% | 96.00% | 96.00% | 7933 ms |
| 🔴 | Digital Egypt | Government | 0.00% | 0.00% | 0.00% | — |
| 🟢 | Egyptian Tax Authority | Government | 100% | 100% | 100% | 2421 ms |
| 🟢 | CAPMAS | Government | 100% | 100% | 100% | 2813 ms |
| 🟢 | Vodafone Egypt | Telecom | 100% | 100% | 100% | 3279 ms |
| 🟢 | Orange Egypt | Telecom | 100% | 100% | 100% | 3358 ms |
| 🟢 | e& Egypt | Telecom | 100% | 100% | 100% | 3109 ms |
| 🟢 | WE (Telecom Egypt) | Telecom | 100% | 100% | 100% | 5502 ms |
| 🟢 | EgyptAir | Travel | 100% | 100% | 100% | 2841 ms |
| 🟢 | Al-Ahram | News | 100% | 100% | 100% | 2926 ms |
| 🟢 | Youm7 | News | 100% | 100% | 100% | 3614 ms |
| 🟢 | Masrawy | News | 100% | 100% | 100% | 3027 ms |
| 🟢 | Cairo University | Education | 100% | 100% | 100% | 6295 ms |

## Recent incidents

| Site | Started (UTC) | Resolved (UTC) | Cause |
|---|---|---|---|
| Fawry | 2026-11-17T10:49:08Z | 2026-11-17T11:03:27Z | Timeout after 15000ms |
| Fawry | 2026-11-16T10:10:21Z | 2026-11-16T18:56:16Z | Timeout after 15000ms |
| Digital Egypt | 2026-11-15T22:03:34Z | ongoing | Connect Timeout Error (attempted address: digital.gov.eg:443, timeout: 10000ms) |
