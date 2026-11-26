# Egyptian websites — live uptime

Checked 20–30 times a day by [`collect.yml`](../.github/workflows/collect.yml) using this project's own probe
(exponential-backoff retries before a site counts as down). **Up** = the server answered with a status below 500
within 15 s. Probes run from GitHub Actions runners (outside Egypt), so sites that block foreign traffic aren't listed.

_Last check: 2026-11-26T23:10:30Z_

|  | Site | Category | Today | 7 days | 30 days | p95 (7d) |
|---|---|---|---|---|---|---|
| 🟢 | Central Bank of Egypt | Banks | 100% | 100% | 100% | 735 ms |
| 🟢 | National Bank of Egypt | Banks | 100% | 100% | 100% | 1657 ms |
| 🟢 | Banque Misr | Banks | 100% | 96.80% | 98.07% | 2891 ms |
| 🟢 | CIB | Banks | 100% | 100% | 99.61% | 3664 ms |
| 🟢 | Fawry | Payments | 100% | 98.08% | 98.07% | 5077 ms |
| 🔴 | Digital Egypt | Government | 0.00% | 0.64% | 0.39% | 2509 ms |
| 🟢 | Egyptian Tax Authority | Government | 100% | 96.80% | 98.07% | 2650 ms |
| 🟢 | CAPMAS | Government | 100% | 100% | 100% | 2879 ms |
| 🟢 | Vodafone Egypt | Telecom | 100% | 98.72% | 99.23% | 3203 ms |
| 🟢 | Orange Egypt | Telecom | 100% | 100% | 100% | 3606 ms |
| 🟢 | e& Egypt | Telecom | 100% | 100% | 99.61% | 3416 ms |
| 🟢 | WE (Telecom Egypt) | Telecom | 100% | 100% | 100% | 5787 ms |
| 🟢 | EgyptAir | Travel | 100% | 100% | 100% | 3583 ms |
| 🟢 | Al-Ahram | News | 100% | 100% | 100% | 3198 ms |
| 🟢 | Youm7 | News | 100% | 100% | 100% | 3697 ms |
| 🟢 | Masrawy | News | 100% | 100% | 99.61% | 3449 ms |
| 🟢 | Cairo University | Education | 100% | 100% | 100% | 6421 ms |

## Recent incidents

| Site | Started (UTC) | Resolved (UTC) | Cause |
|---|---|---|---|
| Digital Egypt | 2026-11-25T21:08:40Z | ongoing | Connect Timeout Error (attempted address: digital.gov.eg:443, timeout: 10000ms) |
| Vodafone Egypt | 2026-11-25T20:54:25Z | 2026-11-25T21:08:40Z | Unexpected status 555 |
| Vodafone Egypt | 2026-11-23T13:04:30Z | 2026-11-23T22:45:45Z | Connect Timeout Error (attempted address: web.vodafone.com.eg:443, timeout: 10000ms) |
| Fawry | 2026-11-23T12:52:18Z | 2026-11-23T22:45:45Z | Timeout after 15000ms |
| Egyptian Tax Authority | 2026-11-22T17:09:35Z | 2026-11-22T17:48:57Z | Timeout after 15000ms |
| Egyptian Tax Authority | 2026-11-22T10:06:37Z | 2026-11-22T10:27:52Z | Connection reset |
| Banque Misr | 2026-11-22T10:06:37Z | 2026-11-22T10:18:05Z | TLS error: UNABLE_TO_GET_ISSUER_CERT_LOCALLY |
| Fawry | 2026-11-21T21:50:50Z | 2026-11-21T22:03:26Z | Timeout after 15000ms |
| Banque Misr | 2026-11-21T10:04:40Z | 2026-11-21T10:16:30Z | Connect Timeout Error (attempted address: www.banquemisr.com:443, timeout: 10000ms) |
| Banque Misr | 2026-11-21T09:19:43Z | 2026-11-21T09:42:15Z | Connect Timeout Error (attempted address: www.banquemisr.com:443, timeout: 10000ms) |
| Banque Misr | 2026-11-21T08:54:21Z | 2026-11-21T09:07:22Z | Connect Timeout Error (attempted address: www.banquemisr.com:443, timeout: 10000ms) |
| CIB | 2026-11-19T18:12:07Z | 2026-11-19T18:23:55Z | Timeout after 15000ms |
| e& Egypt | 2026-11-18T18:42:01Z | 2026-11-18T18:52:45Z | Connection refused |
| Masrawy | 2026-11-18T18:31:59Z | 2026-11-18T18:42:01Z | Timeout after 15000ms |
| Fawry | 2026-11-17T10:49:08Z | 2026-11-17T11:03:27Z | Timeout after 15000ms |
