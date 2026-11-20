# ScopePulse · GenLayer Builder evidence

ScopePulse compares versions of engineering requirements and demonstrates how GenLayer can adjudicate semantic drift. A line diff shows the text edits. The Intelligent Contract asks validators to evaluate the impact and requires agreement on the verdict and decisive evidence before storing an assessment.

## Review without a wallet

1. Open the [Reviewer Demo](https://scopepulse-genlayer.vercel.app/#demo).
2. Select each scenario and compare the original and revised requirements. Review the highlighted diff, expected verdict, rationale, and exact excerpts.
3. Check **Bradbury deployment evidence**. The app resolves the wallet transaction to the GenLayer deployment ID and verifies finalization, execution, and the contract address against its production configuration.
4. Visit [History](https://scopepulse-genlayer.vercel.app/#history) and the [Usage Guide](https://scopepulse-genlayer.vercel.app/#guide). History shows real submissions tracked in the current browser. Simulated examples stay in the reviewer demo.

| Scenario | Expected outcome | Rationale |
| --- | --- | --- |
| Reporting · Export formats | Compatible | CSV supplements PDF and retains the report date requirement. |
| Security · Audit-log retention | Potential conflict | Deleting logs at 30 days violates a 90-day retention minimum. |
| Finance · Refund approval | Needs review | “Authorized staff” needs a role definition before the impact can be determined. |

These outcomes are authored simulations. A successful Bradbury dry run for the retention example verified the callable assessment path and fee estimation. A finalized assessment evidence card requires a separate, successfully executed assessment transaction.

## Verified deployment

| Evidence | Value |
| --- | --- |
| Network | Bradbury Phase 2, chain ID 4221 |
| Contract | `0xC437D73bCd58b8B5a3Fe5e601A6B9A2283E2D64F` |
| GenLayer deployment ID | `0xf3b0c431e13c7306e922abac5ff8d9ac7c45773b32e6144292965f7b01c4e96e` |
| GenLayer consensus status | `FINALIZED` |
| GenLayer execution status | `FINISHED_WITH_RETURN` |
| Wallet transaction | [Bradbury explorer](https://scan.testnet-chain.genlayer.com/tx/0x1216a73d54b6d12ce440ecaef275a3b8a74e2d1f2b1d9f9d4f79637486b1b58f) |
| Source | [Python contract](contracts/scopepulse.py), checked against deployed source |
| Repository | [alaminvyn/scopepulse-genlayer](https://github.com/alaminvyn/scopepulse-genlayer), private |

## Audit and test coverage

The React/Vite frontend uses the public Bradbury RPC. Wallet connection requests account access and a network switch when needed. The assessment path checks the account, chain identity, consensus recipient, and protocol deposit before forwarding a write. Submitted requirements would become public on Bradbury. The Python contract only evaluates and stores results.

- `pnpm build` runs TypeScript checking and creates the production bundle.
- `pnpm test` checks deterministic comparisons and UTF-8 sizing.
- `python3 -m unittest discover -s tests -v` exercises assessment logic with stubbed GenVM and model calls.

## Release status

The Blockaid review is pending. Wallet writes are paused in production. A signed assessment, finalized verdict, and its explorer evidence remain pending. The demo, deployment evidence, and history reads work without connecting a wallet. GitHub repository access is required to review the private source.
