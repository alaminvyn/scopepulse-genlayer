# ScopePulse · GenLayer Builder evidence

ScopePulse compares versions of engineering requirements and demonstrates how GenLayer can adjudicate semantic drift. A line diff shows the text edits. The Intelligent Contract asks validators to evaluate the impact and requires agreement on the verdict and decisive evidence before storing an assessment.

## Independently verified assessment

Open the [live audit-log report](https://scopepulse-genlayer.vercel.app/#verify/wallet/0x1af8c4a8a7d257c7f6127ded97c0575bc541c03b617daccecf88bee6a41c7206) in a fresh browser. The report retrieves the transaction and contract state without a wallet or browser history.

| Evidence | Observed value |
| --- | --- |
| Network and L2 block | Bradbury Phase 2, chain ID 4221, block 627122 |
| L2 wallet transaction | [Successful explorer receipt](https://scan.testnet-chain.genlayer.com/tx/0x1af8c4a8a7d257c7f6127ded97c0575bc541c03b617daccecf88bee6a41c7206) |
| GenLayer assessment ID | `0x03bad067952249142e5fdf4bd33a993b1a33b2c8c93713e24fa4c363014a4ec2` |
| Request ID | `4a96b60605db49098047633c3b1d510f` |
| GenLayer consensus and execution | `FINALIZED` and `FINISHED_WITH_RETURN` |
| Contract | `0xC437D73bCd58b8B5a3Fe5e601A6B9A2283E2D64F` |
| Stored verdict | `potential_conflict` |
| Original evidence | Retain audit logs for at least 90 days. |
| Revised evidence | Delete audit logs after 30 days. |
| Outer protocol deposit | `0.100000000000010352 GEN`, with zero inner user value |
| Production source | [Frontend commit 34ed1af](https://github.com/alaminvyn/scopepulse-genlayer/commit/34ed1af8bb931ac5a6977220a65afec9ea6c74d5) |

The stored rationale identifies the conflict between the 90-day minimum and deletion after 30 days. Both versions retain the administrator-only viewing requirement. The independent check decoded the L2 consensus envelope and GenLayer assessment, confirmed successful finalization, and matched both excerpts read from final contract state against the transaction inputs.

## Review without a wallet

1. Open the [Reviewer Demo](https://scopepulse-genlayer.vercel.app/#demo).
2. Select each scenario and compare the original and revised requirements. Review the highlighted diff, expected verdict, rationale, and exact excerpts.
3. Check **Bradbury deployment evidence**. The app resolves the wallet transaction to the GenLayer deployment ID and verifies finalization, execution, and the contract address against its production configuration.
4. Open [Verify assessment](https://scopepulse-genlayer.vercel.app/#verify) to inspect a GenLayer ID or wallet hash. For a negative control, enter the deployment wallet hash below. The report should reject it as an assessment.
5. Visit [History](https://scopepulse-genlayer.vercel.app/#history) and the [Usage Guide](https://scopepulse-genlayer.vercel.app/#guide). History shows real submissions tracked in the current browser. Simulated examples stay in the reviewer demo.

| Scenario | Expected outcome | Rationale |
| --- | --- | --- |
| Reporting · Export formats | Compatible | CSV supplements PDF and retains the report date requirement. |
| Security · Audit-log retention | Potential conflict | Deleting logs at 30 days violates a 90-day retention minimum. |
| Finance · Refund approval | Needs review | “Authorized staff” needs a role definition before the impact can be determined. |

These three outcomes are authored simulations. The [finalized audit-log report](https://scopepulse-genlayer.vercel.app/#verify/wallet/0x1af8c4a8a7d257c7f6127ded97c0575bc541c03b617daccecf88bee6a41c7206) reads a separate on-chain transaction and exposes its actual verdict and evidence.

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

## Verification model

The public report checks the configured Bradbury genesis, resolves a wallet hash through a consensus event when supplied, requires GenLayer finalization and successful execution, and matches the recipient and decoded assessment call. It then reads the final contract state by caller and request ID and validates the result and literal source excerpts. A GenLayer report URL contains the ID alone. A wallet-hash URL also lets the app supply the matched L2 explorer receipt.

The contract returns one overall verdict, a short rationale, and one or two excerpt pairs. The excerpts are checked against calldata. The front end does not infer validator confidence, business severity, individual validator reasoning, or exhaustive conflict coverage. The line diff, inline replacements, and wording cues are deterministic local views. The three demo outcomes are authored examples.

## Audit and test coverage

The React/Vite frontend uses the public Bradbury RPC. Wallet connection requests account access and a network switch when needed. The assessment path checks the account, chain identity, consensus recipient, and protocol deposit before forwarding a write. Submitted requirements would become public on Bradbury. The Python contract only evaluates and stores results.

- `pnpm build` runs TypeScript checking and creates the production bundle.
- `pnpm test` checks diff, source mapping, report IDs, evidence parsing, and the wallet request path with mock EIP-1193 providers.
- `pnpm test:browser` checks desktop and mobile behavior, the wallet pause, and unavailable-report states with network calls blocked.
- `pnpm verify:bradbury` checks the live deployment, receipt association, exact deployed source, and schema using public reads.
- `python3 -m unittest discover -s tests -v` exercises assessment logic with stubbed GenVM and model calls.

## Production audit

- The production build and 29 automated tests passed, including 11 wallet integration mocks. A fresh build using the public production settings matched the deployed HTML, JavaScript, and CSS byte for byte. The SDK chunk-size warning remains.
- The public report was verified in fresh desktop (1440 px) and mobile (390 px) Chrome contexts. It opened with empty local storage and zero wallet-provider access. Both contexts exercised history recovery, navigation, comparison controls, and separation of the simulation from the real verdict.
- Wallet writes are enabled for Vercel Production. The contract source matches the verified deployment. No wallet connection, signing, or write was performed during the audit.
- The dependency audit returned zero known advisories. A pattern scan of 55 tracked historical blobs found no candidate secrets. HTTPS and HSTS were present. The production response did not include a Content Security Policy or explicit frame protection.
- The repository is private. Share access with Builder reviewers if source review is required. The report and block explorer are public.

## Limitations

- The verified report records one real audit-log assessment. The compatible and needs-review examples illustrate expected outcomes. Wallet behavior across other extensions and networks was not verified on-chain.
- Reports depend on public Bradbury RPC availability and the supported ScopePulse deployment. History is browser-local and must be recovered by transaction identifier in another browser.
- Requirement inputs are limited to 2,048 UTF-8 bytes per version. Fee simulation can send both versions to the RPC, and signed assessment inputs are public in calldata. Use synthetic or non-confidential text.
- Explorer success establishes L2 inclusion. The verifier separately checks GenLayer finalization, successful execution, and matching contract readback.

## Demonstration recording plan

1. Start in a clean browser on the dashboard. Use the comparison workspace to highlight the 90-day to 30-day change in split view, then switch to unified view.
2. Open the reviewer example, label it as a simulation in the English narration, and jump from an excerpt to its source line.
3. Open the public report in a clean context. Pause on the verified verdict, evidence, and transaction identifiers, then open the explorer. Explain the distinction between L2 success and GenLayer finality.
4. Close with the report link and verified contract address. Record with the existing report and a wallet-free browser session.
