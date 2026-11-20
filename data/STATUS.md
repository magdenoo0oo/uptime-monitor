# Egyptian websites — live uptime

Checked 20–30 times a day by [`collect.yml`](../.github/workflows/collect.yml) using this project's own probe
(exponential-backoff retries before a site counts as down). **Up** = the server answered with a status below 500
within 15 s. Probes run from GitHub Actions runners (outside Egypt), so sites that block foreign traffic aren't listed.

_Last check: 2026-11-20T21:58:36Z_

|  | Site | Category | Today | 7 days | 30 days | p95 (7d) |
|---|---|---|---|---|---|---|
| 🟢 | Central Bank of Egypt | Banks | 100% | 100% | 100% | 820 ms |
| 🟢 | National Bank of Egypt | Banks | 100% | 100% | 100% | 1758 ms |
| 🟢 | Banque Misr | Banks | 100% | 100% | 100% | 2321 ms |
| 🟢 | CIB | Banks | 100% | 99.21% | 99.21% | 3279 ms |
| 🟢 | Fawry | Payments | 100% | 98.41% | 98.41% | 4660 ms |
| 🔴 | Digital Egypt | Government | 0.00% | 0.00% | 0.00% | — |
| 🟢 | Egyptian Tax Authority | Government | 100% | 100% | 100% | 2427 ms |
| 🟢 | CAPMAS | Government | 100% | 100% | 100% | 2734 ms |
| 🟢 | Vodafone Egypt | Telecom | 100% | 100% | 100% | 3328 ms |
| 🟢 | Orange Egypt | Telecom | 100% | 100% | 100% | 3358 ms |
| 🟢 | e& Egypt | Telecom | 100% | 99.21% | 99.21% | 3109 ms |
| 🟢 | WE (Telecom Egypt) | Telecom | 100% | 100% | 100% | 5904 ms |
| 🟢 | EgyptAir | Travel | 100% | 100% | 100% | 3129 ms |
| 🟢 | Al-Ahram | News | 100% | 100% | 100% | 2941 ms |
| 🟢 | Youm7 | News | 100% | 100% | 100% | 3697 ms |
| 🟢 | Masrawy | News | 100% | 99.21% | 99.21% | 3449 ms |
| 🟢 | Cairo University | Education | 100% | 100% | 100% | 5907 ms |

## Recent incidents

| Site | Started (UTC) | Resolved (UTC) | Cause |
|---|---|---|---|
| CIB | 2026-11-19T18:12:07Z | 2026-11-19T18:23:55Z | Timeout after 15000ms |
| e& Egypt | 2026-11-18T18:42:01Z | 2026-11-18T18:52:45Z | Connection refused |
| Masrawy | 2026-11-18T18:31:59Z | 2026-11-18T18:42:01Z | Timeout after 15000ms |
| Fawry | 2026-11-17T10:49:08Z | 2026-11-17T11:03:27Z | Timeout after 15000ms |
| Fawry | 2026-11-16T10:10:21Z | 2026-11-16T18:56:16Z | Timeout after 15000ms |
| Digital Egypt | 2026-11-15T22:03:34Z | ongoing | Connect Timeout Error (attempted address: digital.gov.eg:443, timeout: 10000ms) |
