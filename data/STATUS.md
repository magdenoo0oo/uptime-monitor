# Egyptian websites — live uptime

Checked 20–30 times a day by [`collect.yml`](../.github/workflows/collect.yml) using this project's own probe
(exponential-backoff retries before a site counts as down). **Up** = the server answered with a status below 500
within 15 s. Probes run from GitHub Actions runners (outside Egypt), so sites that block foreign traffic aren't listed.

_Last check: 2026-11-19T17:59:17Z_

|  | Site | Category | Today | 7 days | 30 days | p95 (7d) |
|---|---|---|---|---|---|---|
| 🟢 | Central Bank of Egypt | Banks | 100% | 100% | 100% | 744 ms |
| 🟢 | National Bank of Egypt | Banks | 100% | 100% | 100% | 1758 ms |
| 🟢 | Banque Misr | Banks | 100% | 100% | 100% | 2321 ms |
| 🟢 | CIB | Banks | 100% | 100% | 100% | 3188 ms |
| 🟢 | Fawry | Payments | 100% | 97.89% | 97.89% | 5078 ms |
| 🔴 | Digital Egypt | Government | 0.00% | 0.00% | 0.00% | — |
| 🟢 | Egyptian Tax Authority | Government | 100% | 100% | 100% | 2421 ms |
| 🟢 | CAPMAS | Government | 100% | 100% | 100% | 2813 ms |
| 🟢 | Vodafone Egypt | Telecom | 100% | 100% | 100% | 3328 ms |
| 🟢 | Orange Egypt | Telecom | 100% | 100% | 100% | 3056 ms |
| 🟢 | e& Egypt | Telecom | 100% | 98.95% | 98.95% | 3071 ms |
| 🟢 | WE (Telecom Egypt) | Telecom | 100% | 100% | 100% | 5904 ms |
| 🟢 | EgyptAir | Travel | 100% | 100% | 100% | 3017 ms |
| 🟢 | Al-Ahram | News | 100% | 100% | 100% | 2926 ms |
| 🟢 | Youm7 | News | 100% | 100% | 100% | 3762 ms |
| 🟢 | Masrawy | News | 100% | 98.95% | 98.95% | 3941 ms |
| 🟢 | Cairo University | Education | 100% | 100% | 100% | 6473 ms |

## Recent incidents

| Site | Started (UTC) | Resolved (UTC) | Cause |
|---|---|---|---|
| e& Egypt | 2026-11-18T18:42:01Z | 2026-11-18T18:52:45Z | Connection refused |
| Masrawy | 2026-11-18T18:31:59Z | 2026-11-18T18:42:01Z | Timeout after 15000ms |
| Fawry | 2026-11-17T10:49:08Z | 2026-11-17T11:03:27Z | Timeout after 15000ms |
| Fawry | 2026-11-16T10:10:21Z | 2026-11-16T18:56:16Z | Timeout after 15000ms |
| Digital Egypt | 2026-11-15T22:03:34Z | ongoing | Connect Timeout Error (attempted address: digital.gov.eg:443, timeout: 10000ms) |
