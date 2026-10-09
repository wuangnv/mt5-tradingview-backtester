# Independent performance workflow review — 09/10/2026

**Verdict: PASS for diagnostic workflow and bounded interpretation. No benchmark or load was rerun.** This does not approve a deployed optimization or framework migration.

## Realistic positive case

For “API chậm, có nên chuyển sang Go, cải thiện bao nhiêu phần trăm?”, the supported answer is: **chưa nên đổi stack; trước tiên đo riêng thời gian kết nối/đọc DB và bỏ thao tác lặp. Chưa có phần trăm cải thiện của Go.**

The current local sequential GET baseline has 15 timed samples plus a separate first request. All recorded statuses are 200. Median health is 2.00ms; session catalog is 642.40ms returning 0 items/12 bytes; first Trades page is 788.31ms returning 0 rows/797 bytes. These are local HTTP measurements, not browser journey or load/capacity measurements. Empty returned data still has substantial latency; a journal-heavy projection percentage cannot explain this empty live baseline.

Source identifies hypotheses worth measuring next: `Store.connect()` creates a fresh connection; `list_records()` first reads IDs then calls `get_record()` with its own connection per record; the paged Trades endpoint builds a full dashboard report and then reads journals before slicing. Source inspection establishes these operations exist, but does not attribute the recorded 642–788ms to any particular phase. Pooling, batch reads and journal indexing are candidates to compare with representative fixtures before considering Go.

## Math, experiment and parity

The source SHA256 in the receipt matches current `trades_page.py`. Probe inspection confirms alternating baseline/candidate order, equal full projection calls, one warm-up each, output equality outside each timed interval, and input digest immutability. The isolated prototype replaces the nested journal scan with an index; it is never installed into product code and excludes HTTP/DB/report construction.

Recalculated medians and formulas match every raw sample set:

| Fixture trades/journals | Baseline median | Prototype median | Latency reduction | Speedup |
| --- | ---: | ---: | ---: | ---: |
| 100/10 | 2.081ms | 1.812ms | 12.92% | 1.15x |
| 1000/0 | 18.338ms | 18.783ms | −2.43% | 0.98x |
| 1000/100 | 50.732ms | 16.501ms | 67.47% | 3.07x |
| 5000/1000 | 1711.685ms | 74.541ms | 95.65% | 22.96x |

The no-journal case does not improve. The large wins apply to journal-heavy synthetic projection only. With 15 samples, the implemented nearest-rank sample p95 is the maximum sample; it is correctly labeled diagnostic and cannot establish stable tail behavior. JSON payload reduction is separately labeled and is not latency reduction or a benchmark of the old full HTTP endpoint.

The 24 parity cases cover six filter patterns × four sort keys, including dual source aliases and duplicate tags. Full output equality includes the passed scope/sources/facets/counts/snapshot and row values. Assumption: contract-valid string session/trade identifiers and valid journal payloads. Numeric or malformed identifiers are excluded, since the index drops nonstrings while the baseline membership test could accept them. Upstream workspace authorization, cutoff/revision resolution and lineage dedup are outside the projection benchmark, even though passed-through output fields remain equal. A production change requires those contracts plus broader datasets, pages, sort directions and unknown/partial cases.

## Routing, scope and environment

Negative case “chỉ căn lại checkbox cho đẹp”: the skill description explicitly excludes visual-only UI edits; use UI-platform visual QA, with no performance measurement triggered by appearance alone. The positive case clearly matches this skill.

The new skill is repo-scoped. Generic workflow remains in `SKILL.md`, MT5 paths/commands/authority remain in the linked reference, and `agents/openai.yaml` adds discovery text only. This complements UI-platform workflow, not a competing UI system or tracker. The script uses existing fixtures/dependencies, bounds repeats to 5–30 and live GET roots to localhost/127.0.0.1 HTTP with no credentials, redirects or environment proxies. No new provider/broker authority, runtime start, DB initialization or persistent configuration requirement is introduced.

Current global skill roots were inventoried read-only: `.agents/skills` contains `ai-environment-maintainer` and `typesafe-ai`; `.codex/skills` contains `.system`, `hatch-pet` and `unity-mcp-skill`. No performance duplicate was found in those active roots. This inventory alone does not prove the exact retired-skill set or its backup contents; those require the cleanup receipt/paths.

## Remaining limits

The receipt records Python version, OS platform, workload, samples, scope and projection source hash. It lacks a full source revision/build, CPU/machine specification and explicit cache manifest. Treat it as an initial diagnostic receipt, not a reproducible cross-machine migration percentage. CPU/RAM/query counts, pool/concurrent load, database phase timings, browser/render/frame timing and a Go implementation are unmeasured.

No blocker or arithmetic defect found in the recorded diagnostic result. Reviewer read source and raw samples only; no provider calls, service changes, secret configuration reads, DB mutations or load reruns.

## Final receipt and environment addendum

The original `measurements.json` and initial interpretation above are retained. `measurements-final.json` is a separate 15-repeat receipt, measured 2026-10-09T06:39:48Z. It adds HEAD, four disk-source hashes, script hash, Python/OS/processor/logical CPU metadata and cache notes. At review, all recorded file hashes matched disk. Disk source identity does not attest the running API process; that distinction is explicitly recorded.

Final live GET medians are health 1.61ms, sessions 662.98ms and Trades 806.30ms, still empty. All response statuses are 200. Final projection medians are 2.259→2.585ms (100/10, −14.47%), 16.298→16.575ms (1000/0, −1.70%), 50.382→15.990ms (1000/100, 68.26%) and 1909.832→77.330ms (5000/1000, 95.95%/24.70x). Recomputed percentages match the receipt. Small-case variation reinforces that the journal-heavy win cannot be transferred to every request.

The added DB microprobe alternates fresh connect/query/close against one warmed reused connection, runs only `SELECT 1`, uses autocommit and requests session default read-only. Its fresh median is 76.2533ms versus reused 0.1760ms, 99.7692% reduction / 433.257x for this exact operation. It is **not a pool benchmark, endpoint optimization or Go comparison**. It supplies evidence that fresh connection setup is expensive locally; it does not account for all live endpoint latency. Reviewer did not rerun DB or load.

Retired exact skill folders and their `SKILL.md` files exist under `C:/Users/MIIKEY/.codex/skill-archive/20261009/{vietnamese-native-writing,adaptive-reporting}`. Corresponding directories are absent from both active personal roots `.agents/skills` and `.codex/skills`. Only filtered path existence was checked; archived `config-before.toml` was neither read nor emitted.

The audit helper drops broad `--no-ignore`, retains `--hidden`, explicitly includes environment filenames/skill paths, and explicitly excludes virtual environments/dependency trees. Local `rg --help` confirms `-g` includes override other ignore logic. This allows ignored irrelevant cache trees to remain pruned while explicitly selected environment paths still participate. Global skill roots remain directly enumerated. This is a reasonable fingerprint scope tradeoff; ignored files outside the selected environment patterns are intentionally not fingerprinted. Root reports the fresh audit as 10 skills / 0 errors / 0 warnings; reviewer inspected the helper but did not independently run that state-writing audit.

One concrete guard issue was reported and is now **closed**: checking DSN `host` alone did not restrict libpq's actual network target when `hostaddr` or inherited `PGHOSTADDR` was supplied. [Official libpq connection documentation](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-PARAMKEYWORDS) states that `hostaddr` supplies the network address when both fields are present. Owner extracted `database_settings(dsn)`, rejects nonloopback host/hostaddr, and pins an explicit loopback `hostaddr` to override environment/service network defaults.

Independent pure-function review executed nine synthetic guard cases without opening any connection: localhost/IPv4/IPv6/local explicit hostaddr accepted with autocommit/read-only settings; remote host, remote hostaddr, mixed multiaddress, mixed multihost and missing host rejected. The accepted cases were also tested with synthetic inherited remote `PGHOSTADDR`, and all returned explicit loopback targets. No real environment DSN was read or output.

`database-guarded.json` retains a separate positive read-only owner-run DB receipt after the fix. Its script hash matches the final guarded source; the earlier final receipt's script hash identifies the pre-guard-correction version and is retained historically. Fifteen samples recalculate to fresh median 71.5202ms and reused median 0.1397ms, 99.8047% / 511.9556x. These remain SELECT1-operation percentages only. The updated skill reference correctly documents `--db-probe`, existing environment DSN, read-only reuse versus fresh connections, and excludes pool/reset/concurrency/API-DSN inference.

**Final verdict remains PASS for the diagnostic workflow, final guarded entrypoint and scoped cleanup review.** No unresolved finding remains in this reviewed slice. Go migration, deployed pooling, production capacity and whole-journey improvement remain unmeasured.
