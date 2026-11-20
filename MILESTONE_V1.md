# ScopePulse Milestone V1 · Single-Clause Policy Assessment

The [accepted ScopePulse baseline](https://github.com/alaminvyn/scopepulse-genlayer/commit/e8fa498dd38b56eef88fbcc9a77bd98a052c236a) compares an original and revised requirement for semantic drift. The milestone adds a second question for reviewers: does this proposed requirement satisfy an explicit policy clause? A new method evaluates the commitment expressed by the requirement, including missing facts such as an unspecified retention period.

GenLayer runs a language-model assessment under its comparative equivalence principle. The comparison criterion requires agreement on the verdict and on the decisive obligation and commitment or missing information. The contract then enforces the result schema and checks each quoted excerpt against its submitted input before storing it. Literal quotes establish provenance. Their presence alone does not prove the conclusion is correct.

## Contract interface

| Method | Behavior |
|---|---|
| `assess_clause(request_id, clause, requirement)` | Accepts a 32-character lowercase hexadecimal request ID and two nonblank inputs up to 2,048 UTF-8 bytes each. Duplicate clause requests from the same caller are rejected. |
| `get_clause_assessment(caller, request_id)` | Returns the stored JSON string or an empty string for an unknown caller/request pair. The transaction and read key identify the request. |

A stored result contains a verdict of `satisfies`, `violates`, or `unclear`, a rationale up to 420 characters, and an `evidence` object with `clause` and `requirement` excerpts up to 200 characters each. Clause and drift assessments have separate storage maps. The original methods and production address remain available. Caller scoping prevents one caller from overwriting another caller's record. The view and submitted text are public.

## Synthetic cases

All cases use the clause **Audit logs must be retained for at least 90 days.**

| Case | Proposed requirement | Expected fixture verdict |
|---|---|---|
| A | Delete all audit logs after 30 days. | `violates` |
| B | Retain audit logs for 120 days before deletion. | `satisfies` |
| C | Archive audit logs according to the standard retention schedule. | `unclear` |

These are the expected fixture verdicts. Case A was also executed on Bradbury and independently verified below. Cases B and C are covered by stubbed tests.

## Reproduce the checks

From the repository root, use Node 24, pnpm 11, and Python 3.

```sh
pnpm install --frozen-lockfile
python3 -m unittest discover -s tests -v
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
git diff --stat e8fa498dd38b56eef88fbcc9a77bd98a052c236a..HEAD
```

The Python suite stubs GenVM, the model, and comparative consensus. It checks the three fixture verdicts, output and excerpt validation, input bounds, request collisions, missing results, caller isolation, and stable serialization under stubbed comparison. The TypeScript wallet tests use mock providers. Playwright exercises the accepted browser workflow with network calls blocked.

**Observed checks:** 12 Python tests, 20 TypeScript tests, and three Playwright tests passed. The Vite build passed with the existing SDK chunk-size warning. The live Bradbury schema RPC accepted the updated source and exposed both clause methods with the expected write/view flags. The accepted deployment verifier separately confirmed the deployed baseline source and successful finalization. The milestone verifier resolved the baseline wallet receipt and rejected it as milestone evidence.

## Finalized Bradbury evidence

The accepted deployment at `0xC437D73bCd58b8B5a3Fe5e601A6B9A2283E2D64F` continues to support the original pairwise drift workflow. Its [finalized audit-log drift report](https://scopepulse-genlayer.vercel.app/#verify/wallet/0x1af8c4a8a7d257c7f6127ded97c0575bc541c03b617daccecf88bee6a41c7206) and [Builder evidence](BUILDER.md) remain available. The milestone uses a separate contract address and adds explicit policy-clause assessment.

| Evidence | Verified value |
|---|---|
| Network | Bradbury Phase 2, chain ID `4221` |
| Milestone contract | `0x8a08fA8e33D982281AAc61Dd845a193dA94644e2` |
| Deployment wallet transaction | [`0x130e5eecbec3d59a13f031ddb2199a6668240d02cedf866a3e5d9a0cbc32a1cc`](https://scan.testnet-chain.genlayer.com/tx/0x130e5eecbec3d59a13f031ddb2199a6668240d02cedf866a3e5d9a0cbc32a1cc) |
| Deployment GenLayer ID | `0x6b97a4fc8e529da8ea2692ad3996ebfad69d9cff6de203cf7972ba8287fb3cd0` |
| Assessment wallet transaction | [`0xc595a1870c2fbac8e7114cdbca5a333dba2c56360a5a026e6cff57dd6a513b02`](https://scan.testnet-chain.genlayer.com/tx/0xc595a1870c2fbac8e7114cdbca5a333dba2c56360a5a026e6cff57dd6a513b02) |
| Assessment GenLayer ID | `0x14debd14e726f6cbef9c43423934ae1c255d65faccfd8b968ce12873b6673d3d` |
| Consensus and execution for both | `FINALIZED` / `FINISHED_WITH_RETURN` |
| Deployed source SHA-256 | `d17e2315c260ca407e3afadbfbd14061485b2dcddb22206637a7419d1e21591d`, matched byte for byte |
| Assessment method, caller, and request ID | `assess_clause` · `0xf6dBF59cCaA56D044c3e7Bb72a136B96C277d52B` · `2c01de8a77d96cd9c24bdeeffeec793a` |
| Stored verdict | `violates` |

**Stored rationale**

> The clause requires retention for at least 90 days. The requirement explicitly mandates deletion after 30 days, which is incompatible as it prevents meeting the 90-day minimum.

Both stored excerpts matched the decoded inputs exactly.

- **Policy.** “Audit logs must be retained for at least 90 days.”
- **Proposed requirement.** “Delete all audit logs after 30 days.”

| Fee in GEN | Deployment | Case A |
|---|---:|---:|
| Protocol deposit | 0.100000000000010352 | 0.100000000000010352 |
| L2 gas paid | 0.00007759517 | 0.00002244654 |
| Protocol refund | 0.099938055500009058 | 0.099936698000009058 |
| **Net cost including gas** | **0.000139539670001294** | **0.000085748540001294** |

[Deployment refund receipt](https://scan.testnet-chain.genlayer.com/tx/0xcb28946a3bd778e55a5c8bfa20041db1943cd4e1ede49bdb64d171dc6fdae336) · [Case A refund receipt](https://scan.testnet-chain.genlayer.com/tx/0x6ef976afd1ea017b14b5b931928d20977def5fc0f09cfdb930a597306671b256)

### Verify without a wallet

```sh
pnpm verify:clause verify \
  wallet:0x130e5eecbec3d59a13f031ddb2199a6668240d02cedf866a3e5d9a0cbc32a1cc \
  wallet:0xc595a1870c2fbac8e7114cdbca5a333dba2c56360a5a026e6cff57dd6a513b02
pnpm verify:bradbury
```

The first command checks the two L2 receipts and their GenLayer IDs, finalization and execution, exact deployed source, decoded call, and final stored result and excerpts. The second command verifies the accepted deployment against its pinned baseline source. Either wallet reference can also be supplied as `genlayer:<id>` to the first command. The explorer refund receipts provide separate fee evidence.

Use synthetic or nonconfidential examples because calldata and state can be public. The caller supplies the policy. The assessment does not establish policy authority, enforce releases, or evaluate multiple clauses. Reviewers use the read-only verifier for clause assessments. The production UI continues to handle pairwise drift.

## Git comparison

| Files | Milestone change |
|---|---|
| `contracts/scopepulse.py` | Adds clause assessment, strict output validation, and caller-scoped retrieval. |
| `tests/test_contract.py` | Adds clause validation, consensus-interface, retrieval, and compatibility coverage. |
| `scripts/verify-clause-bradbury.mts`, `package.json` | Adds schema and quote preflight and wallet-free live evidence checks. |
| `scripts/verify-bradbury.mts` | Compares the accepted deployment to its pinned baseline instead of milestone source. |
| `BUILDER.md`, `README.md`, `MILESTONE_V1.md` | Notes public repository access, pins accepted source links, and documents the finalized milestone. |

## Builder submission copy

**Title**

ScopePulse Milestone V1 — Single-Clause Policy Assessment

**Changes & Improvements**

ScopePulse adds single-clause policy assessment to its accepted requirement-drift workflow. The new Intelligent Contract method uses GenLayer comparative consensus to decide whether a proposed requirement satisfies, violates, or is unclear under an explicit policy clause. It stores the verdict, rationale, and exact excerpts for retrieval by caller and request ID. A real Bradbury Phase 2 assessment finalized successfully with a violates verdict for deleting audit logs after 30 days under a 90-day retention policy. The milestone includes a wallet-free verifier for finality, decoded inputs, deployed source, and stored evidence, plus automated coverage for all three outcomes and the original workflow.
