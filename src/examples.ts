import type { Assessment } from './verification';

export const deployment = {
  address: '0xC437D73bCd58b8B5a3Fe5e601A6B9A2283E2D64F',
  id: '0xf3b0c431e13c7306e922abac5ff8d9ac7c45773b32e6144292965f7b01c4e96e',
  envelope: '0x1216a73d54b6d12ce440ecaef275a3b8a74e2d1f2b1d9f9d4f79637486b1b58f',
} as const;

export const examples: { name: string; original: string; revised: string; expected: Assessment }[] = [
  {
    name: 'Reporting · Export formats',
    original: 'Users can export reports as PDF.\nExports include the report date.',
    revised: 'Users can export reports as PDF.\nUsers can also export reports as CSV.\nExports include the report date.',
    expected: {
      verdict: 'compatible',
      rationale: 'CSV is an additional export option. PDF support and the report date are both preserved.',
      evidence: [{ original: 'Users can export reports as PDF.', revised: 'Users can also export reports as CSV.' }],
    },
  },
  {
    name: 'Security · Audit-log retention',
    original: 'Retain audit logs for at least 90 days.\nOnly administrators can view audit logs.',
    revised: 'Delete audit logs after 30 days.\nOnly administrators can view audit logs.',
    expected: {
      verdict: 'potential_conflict',
      rationale: 'Deleting the same logs after 30 days conflicts with the original 90-day minimum retention.',
      evidence: [{ original: 'Retain audit logs for at least 90 days.', revised: 'Delete audit logs after 30 days.' }],
    },
  },
  {
    name: 'Finance · Refund approval',
    original: 'Managers approve refunds.\nRecord each approval in the audit log.',
    revised: 'Authorized staff approve refunds.\nRecord each approval in the audit log.',
    expected: {
      verdict: 'needs_review',
      rationale: 'The revised role is undefined. Confirm whether authorization remains limited to managers or extends to other staff.',
      evidence: [{ original: 'Managers approve refunds.', revised: 'Authorized staff approve refunds.' }],
    },
  },
];
