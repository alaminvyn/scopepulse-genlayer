# ScopePulse

ScopePulse compares two versions of a software requirement and uses a GenLayer Intelligent Contract to review whether the revision preserves, conflicts with, or leaves an original obligation unclear.

## Review requirements

1. Open [New assessment](https://scopepulse-genlayer.vercel.app/#compare). Paste the two versions or load the synthetic audit-log example. Each version supports up to 2,048 UTF-8 bytes. Editing and comparison stay in the browser.
2. Use **Split** or **Unified**, navigate change groups, and expand unchanged context when needed. Local cues identify visible changes to numbers, timing, roles, or obligation wording.
3. Open the [Reviewer Demo](https://scopepulse-genlayer.vercel.app/#demo) for three authored examples. Click an evidence line to jump to its source. The Bradbury deployment check is a separate live read.
4. Open [Verify assessment](https://scopepulse-genlayer.vercel.app/#verify) with a GenLayer ID or wallet transaction hash. Copy the ID-only report link for another reviewer. Once an assessment is verified, print the report or save it to browser history.
5. Use [History](https://scopepulse-genlayer.vercel.app/#history) to search and filter locally tracked results. Open a public report to recover its reference in another browser.

Wallet writes are paused while the Blockaid review is unresolved. The quote path, when enabled, can transmit input text to the public RPC. A signed transaction makes both versions public in its calldata.

## Run locally

Use Node.js 22.18+ or 24 and pnpm. Install with `pnpm install --frozen-lockfile`, start with `pnpm dev`, then open the URL printed by Vite. The local comparison and simulated demo run with no environment configuration. Set the public contract address to enable the live deployment check. Wallet writes stay disabled unless `VITE_ENABLE_WALLET_WRITES=true` is set.

Use pnpm 11 with Node.js 24 for the reproducible CI environment.

| Command | Coverage |
| --- | --- |
| `pnpm build` | TypeScript checking and the production bundle |
| `pnpm test` | Deterministic changes, source ranges, report validation, and isolated wallet/RPC integration mocks |
| `python3 -m unittest discover -s tests -v` | Contract input and storage behavior with stubbed GenVM and model responses |
| `pnpm exec playwright install chromium` then `pnpm test:browser` | Desktop comparison, mobile reviewer experience, wallet pause, and report lookup failures |
| `pnpm verify:bradbury` | Read-only public RPC and explorer validation of the deployment, source, and schema |

The wallet suite uses the pinned SDK with a mock EIP-1193 provider and mocked RPC responses. It exercises unsigned request construction, fee and calldata checks, rejection, and readback recovery. Run just that suite with `pnpm exec node --experimental-strip-types --test tests/wallet.test.ts`. The browser suite blocks the Bradbury RPC to exercise predictable failure states. The separate Bradbury script checks the live network without signing or publishing a transaction.

## Deploy on Bradbury Phase 2

1. In the local development preview, add `#deploy` to the page URL. This route is available only in development with the explicit wallet flag enabled. The existing production contract should be reused for this release.
2. Choose **Connect wallet & quote**. The app checks the Phase 2 genesis on both the wallet and the GenLayer RPC, validates the bundled contract schema, and shows the SDK's deployment fee quote. The zero-argument constructor performs no nondeterministic work.
3. Click **Sign deployment** and confirm in your browser wallet. Save the wallet transaction hash and GenLayer ID. Wait for **Finalized · verified**, then copy the contract address. If there is an interruption after broadcast, use the existing wallet transaction to recover the GenLayer ID.
4. Copy `.env.example` to `.env.local` and set `VITE_SCOPEPULSE_CONTRACT` to the verified address. Restart the dev server. The browser submits an RPC simulation before quoting a write when no measured fee profile is supplied. In production, use profile quantities measured against the deployed runtime and the bounded representative inputs. Set all three optional allocation fields together.
5. Submit at least one example through the app. Keep the assessment's GenLayer ID and wallet transaction hash. Set `VITE_DEMO_TRANSACTION` to the verified GenLayer ID to enable its wallet-free readback and `VITE_DEMO_ENVELOPE` to its optional wallet hash for the explorer link.

| Live scenario | Original | Revised | Expected verdict |
| --- | --- | --- | --- |
| Export formats | Users can export reports as PDF. | Users can export reports as PDF. Users can also export as CSV. | Compatible |
| Audit retention | Retain audit logs for at least 90 days. | Delete audit logs after 30 days. | Potential conflict |
| Refund approval | Managers approve refunds. | Authorized staff approve refunds. | Needs review |

Check the verdict and literal evidence after finalization for every scenario. Differences between a predicted verdict and an actual outcome belong in the release notes. Refer to [GenLayer fee profiling](https://docs.genlayer.com/developers/decentralized-applications/fee-profiling-and-estimation) for generating a reusable measured policy.

## Publish on GitHub and Vercel

1. In GitHub Desktop, choose **File → Add Local Repository** and select this project folder. Choose **Publish repository**, enter `scopepulse-genlayer`, and choose the visibility for your intended audience.
2. In [Vercel](https://vercel.com/new), choose **Add New → Project** and import the GitHub repository. Select the **Vite** preset, the repository root, and the default `dist` output. Authorize access to this repository if Vercel requests it.
3. Add the public variables from `.env.example` that are configured locally. All `VITE_` variables are public. Deploy, then open the site in a fresh browser session and verify the demo, assessment state, and explorer links.
4. Record the Vercel URL, contract address, deployment hash, and validated sample transaction. A site can be published for comparison and review before the chain workflow is ready. The full MVP requires a successful finalized assessment from the live site.

## Compatibility and release evidence

The SDK is pinned to `genlayer-js@2.0.0-rc.3`. Bradbury Phase 2 uses chain ID 4221 and genesis `0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4`. The GenLayer node at `https://rpc-bradbury.genlayer.com` provides Intelligent Contract calls. The SDK's default L2 endpoint is used for wallet network setup.

The [production site](https://scopepulse-genlayer.vercel.app/) runs on Vercel. The initial Bradbury contract at `0xC89DbD4Abf4748611d1c9C6929Ae17Bf67802553` reached GenLayer `FINALIZED` with `FINISHED_WITH_RETURN` during deployment. Its GenLayer deployment ID is `0xfb4d4fb80ca5b9ce66cc1ac8208aeb26f0a6c442d0f3adc13e494734aff922a9`. [Deployment wallet transaction](https://scan.testnet-chain.genlayer.com/tx/0x96b7ae2f0a5ad5535c3958d8705f124d522a12fb37b78f4c11222ad4c3a04773)

The initial immutable deployment failed an assessment dry run because its GenVM runner requires a positional argument for the comparison principle. The corrected contract at `0xC437D73bCd58b8B5a3Fe5e601A6B9A2283E2D64F` reached GenLayer `FINALIZED` with `FINISHED_WITH_RETURN` and its deployed source matches this repository. The GenLayer deployment ID is `0xf3b0c431e13c7306e922abac5ff8d9ac7c45773b32e6144292965f7b01c4e96e`. [Corrected deployment wallet transaction](https://scan.testnet-chain.genlayer.com/tx/0x1216a73d54b6d12ce440ecaef275a3b8a74e2d1f2b1d9f9d4f79637486b1b58f)

The synthetic audit-log example passed a live Bradbury simulation. A wallet-signed assessment and its finalized verdict are pending while Blockaid reviews the site warning. See the [GenLayer Builder evidence](BUILDER.md) for the reviewer path, verification steps, and release status.

[GenLayer networks](https://docs.genlayer.com/developers/networks) · [Consensus v0.6 migration](https://docs.genlayer.com/developers/consensus-v06-migration)
